/* Shared battlefield semantics. Platform adapters and state are supplied by the presenter. */
int ra2_modern_controls(void) {
    return modern_compare_exchange(&g_modern_controls, 0, 0) != 0;
}

/* Called only from the lifted battlefield message dispatcher. A short right
 * click reuses the game's left-click action resolver. Once the pointer crosses
 * the Windows drag threshold, keep the native right-button path for camera pan. */
uint32_t ra2_modern_mouse_message(uint32_t message, int special_mode_active) {
    g_modern_right_click = 0;
#ifdef __EMSCRIPTEN__
    extern void web_modern_trace(const char *, uint32_t, uint32_t, uint32_t);
    if (message == WM_RBUTTONDOWN || message == WM_RBUTTONUP)
        web_modern_trace("dispatch", message, (uint32_t)special_mode_active,
                         (uint32_t)ra2_modern_controls());
#endif
    if (!modern_compare_exchange(&g_modern_controls, 0, 0) || special_mode_active) {
        g_modern_right_gesture = 0;
        g_modern_right_pending = 0;
        g_modern_right_drag = 0;
        g_modern_suppress_left_release = 0;
        g_modern_suppress_right_deselect = 0;
        input_live_map_right_to_left(0);
        return message;
    }
    if (message == WM_RBUTTONDOWN) {
        g_modern_right_gesture = 1;
        g_modern_right_pending = 0;
        g_modern_right_drag = 0;
        g_modern_suppress_left_release = 0;
        g_modern_suppress_right_deselect = 0;
        modern_cursor(&g_modern_right_origin);
        input_live_map_right_to_left(1);
        return WM_LBUTTONDOWN;
    }
    if (message == WM_MOUSEMOVE && g_modern_right_gesture && !g_modern_right_drag) {
        if (g_modern_right_pending) {
            g_modern_right_pending = 0;
            g_modern_right_drag = 1;
            return WM_RBUTTONDOWN;          /* start native pan after the left release was handled */
        }
        modern_point_t point;
        if (modern_cursor(&point)) {
            int dx = modern_drag_x();
            int dy = modern_drag_y();
            if (dx < 1) dx = 4;
            if (dy < 1) dy = 4;
            if (abs(point.x - g_modern_right_origin.x) >= dx ||
                abs(point.y - g_modern_right_origin.y) >= dy) {
                g_modern_right_pending = 1;
                g_modern_suppress_left_release = 1;
                input_live_map_right_to_left(0);
                return WM_LBUTTONUP;        /* release the synthetic left-down without a click */
            }
        }
        return message;
    }
    if (message == WM_RBUTTONUP && g_modern_right_gesture) {
        int was_pending = g_modern_right_pending;
        int was_drag = g_modern_right_drag;
        g_modern_right_gesture = 0;
        g_modern_right_pending = 0;
        g_modern_right_drag = 0;
        g_modern_suppress_right_deselect = was_drag;
        input_live_map_right_to_left(0);
        if (was_drag) return message;       /* preserve native right-up */
        if (was_pending) return 0;          /* threshold crossed before a native pan could start */
        g_modern_right_click = 1;
        return WM_LBUTTONUP;
    }
    return message;
}

/* RadarClass encodes left-button events in the low flag nibble and
 * right-button events in the high nibble. Hover's 0x88 flag is symmetric,
 * so swapping nibbles changes button semantics without turning hover into a
 * click action. */
uint32_t ra2_modern_radar_event_flags(uint32_t flags) {
    if (!modern_compare_exchange(&g_modern_controls, 0, 0)) {
        input_live_swap_left_right(0);
        return flags;
    }
    input_live_swap_left_right(input_live_button_state() & (MK_LBUTTON | MK_RBUTTON));
    return ((flags & 0x0Fu) << 4) | ((flags & 0xF0u) >> 4);
}

/* Results of ra2_modern_left_click_action besides the game's own action
 * values. The mouse-up patch in run_lift.py ('action' in MODERN_CONTROLS_TARGETS)
 * tests for these exact values.
 *
 * Action None does not make the mouse-up handler (0x004AB9B0) a no-op: with a
 * selectable, unselected target it still takes the select branch (0x004ABDE1).
 * A click that must not select anything therefore passes None with no target
 * at all, which leaves the handler through its plain exit. */
#define MODERN_CLICK_CLEAR_SELECTION 0xFFFFFFFFu /* clear the selection, then None */
#define MODERN_CLICK_IGNORE          0xFFFFFFFEu /* None with the target dropped */

/* The game's Action values the resolver rewrites. */
enum { ACTION_NONE = 0, ACTION_MOVE = 1, ACTION_SELECT = 7, ACTION_TOGGLE_SELECT = 8 };

uint32_t ra2_modern_left_click_action(uint32_t action, uint32_t target,
                                      uint32_t target_vtable, int selected_in_group,
                                      uint32_t selection_count, int special) {
#ifdef __EMSCRIPTEN__
    extern void web_modern_trace(const char *, uint32_t, uint32_t, uint32_t);
    if (g_modern_right_click)
        web_modern_trace("action", action, target, ((uint32_t)special << 24) | selection_count);
#endif
    /* The release that hands a right-drag to the native pan is not a click. */
    if (g_modern_suppress_left_release) {
        g_modern_suppress_left_release = 0;
        return MODERN_CLICK_IGNORE;
    }
    modern_int_t double_click_at = modern_exchange(&g_modern_left_double_click_at, 0);
    int double_click = double_click_at &&
        (uint32_t)(modern_ticks() - (uint32_t)double_click_at) <= modern_double_time();
    int additive_double_click = modern_exchange(&g_modern_left_double_click_shift, 0) &&
        double_click;
    if (!modern_compare_exchange(&g_modern_controls, 0, 0) || special)
        return action;

    int selecting = action == ACTION_SELECT || action == ACTION_TOGGLE_SELECT;
    if (g_modern_right_click) {
        /* A routed right-click issues contextual orders only. Select and
         * ToggleSelect would change the selection, and None can too (see
         * MODERN_CLICK_IGNORE). Every other action passes through. */
        return action == ACTION_NONE || selecting ? MODERN_CLICK_IGNORE : action;
    }

    int selectable_unit = target && (target_vtable == RA2_MODERN_UNIT_VTABLE ||
                                     target_vtable == RA2_MODERN_INFANTRY_VTABLE ||
                                     target_vtable == RA2_MODERN_AIRCRAFT_VTABLE);
    if (!double_click && action == ACTION_MOVE && selectable_unit && !selected_in_group &&
        modern_compare_exchange(&g_modern_shift_box_select, 0, 0))
        g_modern_skip_selection_clear = 1;

    if (double_click && selectable_unit) {
        /* The game's same-type selection runs once the mouse-up handler has
         * returned (ra2_modern_take_type_select), so its own on-screen and
         * ownership rules apply. Shift keeps the old group while it adds the
         * matching units. */
        g_modern_type_select = 1;
        if (additive_double_click) {
            g_modern_skip_selection_clear = 1;
            return MODERN_CLICK_IGNORE;
        }
        return action == ACTION_MOVE ? ACTION_SELECT : selecting ? action : ACTION_NONE;
    }

    /* Shift on an object that is already selected: the game's own ToggleSelect,
     * which calls only that object's Deselect(). */
    if (target && selected_in_group && modern_compare_exchange(&g_modern_shift_box_select, 0, 0))
        return ACTION_TOGGLE_SELECT;

    /* A unit in a multi-unit selection: force the ordinary single-object path,
     * which clears the group before adding the clicked unit back. */
    if (selectable_unit && selected_in_group && selection_count > 1) return ACTION_SELECT;

    /* Open ground: a plain click clears the selection; with Shift, which only
     * ever adds to the selection, it leaves it alone. */
    if (!target) {
        if (selecting) return action;
        return modern_compare_exchange(&g_modern_shift_box_select, 0, 0)
            ? MODERN_CLICK_IGNORE : MODERN_CLICK_CLEAR_SELECTION;
    }
    if (action == ACTION_MOVE) return ACTION_SELECT;
    return selecting ? action : ACTION_NONE;
}

/* After the click's mouse-up handler: whether it asked for a same-type
 * selection, which the lifted hook runs before ra2_modern_end_left_up. */
int ra2_modern_take_type_select(void) {
    int type_select = g_modern_type_select;
    g_modern_type_select = 0;
    return type_select;
}

/* The click is done: a selection-clear skip it set and did not use must not
 * leak into a later click. */
void ra2_modern_end_left_up(void) {
    g_modern_skip_selection_clear = 0;
    g_modern_box_shift = 0;
}

/* The shared selection-clear routine (sub_0048DC90 in Yuri's Revenge): skip it
 * once during a Shift-click or Shift-double-click that adds to the selection,
 * or at the end of a Shift box drag. */
int ra2_modern_preserve_global_selection_clear(void) {
    modern_int_t modern = modern_compare_exchange(&g_modern_controls, 0, 0);
    if (g_modern_skip_selection_clear) {
        g_modern_skip_selection_clear = 0;
        if (modern) return 1;
    }
    modern_int_t dragged = modern_compare_exchange(&g_modern_shift_box_dragged, 0, 0);
    modern_int_t shifted = dragged
        ? modern_exchange(&g_modern_shift_box_select, 0)
        : modern_compare_exchange(&g_modern_shift_box_select, 0, 0);
    return modern && dragged && shifted;
}

/* The mouse-up handler's own box-selection and target-object clear calls. */
int ra2_modern_preserve_shift_selection(void) {
    modern_int_t modern = modern_compare_exchange(&g_modern_controls, 0, 0);
    modern_int_t latched = modern_exchange(&g_modern_shift_box_select, 0);
    if (modern && latched) g_modern_box_shift = 1;
    return modern && latched;
}

/* A Shift box selection adds the boxed units, unless every one of them is
 * selected already: then it removes them. The lifted hooks walk the box twice,
 * a dry run that only counts (ra2_modern_box_object) and then the real one. */
enum { MODERN_BOX_SELECT, MODERN_BOX_COUNT, MODERN_BOX_DESELECT };

int ra2_modern_shift_box_begin(void) {
    int shift = g_modern_box_shift || modern_compare_exchange(&g_modern_shift_box_select, 0, 0);
    if (!modern_compare_exchange(&g_modern_controls, 0, 0) || !shift) return 0;
    g_modern_box_mode = MODERN_BOX_COUNT;
    g_modern_box_objects = g_modern_box_unselected = 0;
    return 1;
}

void ra2_modern_shift_box_decide(void) {
    g_modern_box_mode = g_modern_box_objects && !g_modern_box_unselected
        ? MODERN_BOX_DESELECT : MODERN_BOX_SELECT;
}

void ra2_modern_shift_box_end(void) {
    g_modern_box_mode = MODERN_BOX_SELECT;
    g_modern_box_shift = 0;
}

/* For each selectable object in the box: 0 skip it, 1 Select() it as the game
 * would, 2 Deselect() it. */
int ra2_modern_box_object(int selected) {
    switch (g_modern_box_mode) {
    case MODERN_BOX_COUNT:
        g_modern_box_objects++;
        if (!selected) g_modern_box_unselected++;
        return 0;
    case MODERN_BOX_DESELECT:
        return selected ? 2 : 0;
    default:
        return 1;
    }
}

int ra2_modern_consume_right_drag_release(void) {
    int consume = g_modern_suppress_right_deselect;
    g_modern_suppress_right_deselect = 0;
    return consume;
}
