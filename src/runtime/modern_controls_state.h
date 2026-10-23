static volatile modern_int_t g_modern_controls;  /* opt-in battlefield semantics */
static volatile modern_int_t g_modern_left_double_click_at;    /* tick of a battlefield double-click */
static volatile modern_int_t g_modern_left_double_click_shift; /* ... made with Shift held */
static volatile modern_int_t g_modern_shift_box_select;        /* Shift held during the left press */
static volatile modern_int_t g_modern_shift_box_dragged;       /* the left press became a drag */
static modern_point_t g_modern_left_press;        /* client point of the left press (window thread only) */
/* and the game thread's own state, for the click being handled: */
static int g_modern_skip_selection_clear; /* the click adds to the selection */
static int g_modern_type_select;         /* the click selects every visible unit of its type */
static int g_modern_box_shift;           /* the box-selection clear was skipped for Shift */
static int g_modern_box_mode;            /* what the box walk's Select() does: MODERN_BOX_* */
static int g_modern_box_objects, g_modern_box_unselected; /* counted by the dry run */
static int g_modern_right_click;         /* set while a routed right-up is resolved */
static int g_modern_right_gesture;       /* right-down is awaiting click vs. drag */
static int g_modern_right_pending;       /* synthetic left-up sent, native right-down next */
static int g_modern_right_drag;          /* native right-drag camera pan is active */
static int g_modern_suppress_left_release;   /* the handoff release must not issue a click */
static int g_modern_suppress_right_deselect; /* a pan release must not clear selection */
static modern_point_t g_modern_right_origin;      /* screen point of the right press */
