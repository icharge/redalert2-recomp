// Names, groups and descriptions of the game's hotkey commands, for the Keyboard tab.

/** The game's own dialog groups its bindings; this keeps the launcher's list just as short. */
export const HOTKEY_CATEGORY_ORDER = [
  "Control",
  "View",
  "Team",
  "Interface",
  "Sidebar",
  "Taunt",
  "Other",
] as const;

const HOTKEY_LABELS: Record<string, string> = {
  ToggleAlliance: "Alliance",
  AllToCheer: "Cheer",
  DeployObject: "Deploy Object",
  GuardObject: "Guard",
  ScatterObject: "Scatter",
  StopObject: "Stop Object",
  PlanningMode: "Waypoints",
  Follow: "Follow",
  ToggleRepair: "Repair Mode",
  ToggleSell: "Sell Mode",
  PlaceBeacon: "Place Beacon",
  CenterView: "Center View",
  CenterOnRadarEvent: "Center on Radar Event",
  CenterBase: "Center on Base",
  Options: "Game Menu",
  InfantryTab: "Infantry Tab",
  StructureTab: "Structure Tab",
  UnitTab: "Unit Tab",
  DefenseTab: "Defense Tab",
  PageUser: "Page User",
  TypeSelect: "Type Select",
  VeterancyNav: "Veterancy Select",
  PreviousObject: "Previous Object",
  NextObject: "Next Object",
  CombatantSelect: "Select All",
  Delete: "Delete",
  ScreenCapture: "Screen Capture",
  CursorCheat: "Cursor Debug",
  RightSidebarUp: "Right Sidebar Up",
  RightSidebarDown: "Right Sidebar Down",
  LeftSidebarUp: "Left Sidebar Up",
  LeftSidebarDown: "Left Sidebar Down",
  SidebarPageUp: "Sidebar Page Up",
  SidebarPageDown: "Sidebar Page Down",
  SidebarUp: "Sidebar Up",
  SidebarDown: "Sidebar Down",
};

const HOTKEY_DESCRIPTIONS: Record<string, string> = {
  CenterView: "Center the view on the selected object, or on the last radar event.",
  Options: "Open or close the game menu.",
  CenterOnRadarEvent: "Center the view on the last radar event.",
  ToggleAlliance: "Open the alliance choices for the selected object.",
  PlaceBeacon: "Place a map beacon at the pointer.",
  AllToCheer: "Make every unit you own cheer.",
  DeployObject: "Deploy or undeploy the selected object.",
  InfantryTab: "Switch the sidebar to the infantry tab.",
  Follow: "Follow the selected object with the camera.",
  GuardObject: "Guard the selected object or area.",
  CenterBase: "Center the view on your construction yard.",
  ToggleRepair: "Toggle repair mode.",
  ToggleSell: "Toggle sell mode.",
  PreviousObject: "Select the previous object.",
  NextObject: "Select the next object.",
  CombatantSelect: "Select all combat units on screen.",
  StructureTab: "Switch the sidebar to the structures tab.",
  UnitTab: "Switch the sidebar to the units tab.",
  StopObject: "Stop the selected units.",
  TypeSelect: "Select every unit of the same type.",
  PageUser: "Page the last player who paged you.",
  DefenseTab: "Switch the sidebar to the defenses tab.",
  ScatterObject: "Scatter the selected units.",
  VeterancyNav: "Cycle the selection between regular, veteran and elite units.",
  PlanningMode: "Toggle waypoint planning mode.",
  Delete: "Delete the selected object or waypoint.",
  ScreenCapture: "Save a screenshot of the game.",
  CursorCheat: "Toggle the cursor debug overlay.",
  RightSidebarUp: "Scroll the right sidebar pane up.",
  RightSidebarDown: "Scroll the right sidebar pane down.",
  LeftSidebarUp: "Scroll the left sidebar pane up.",
  LeftSidebarDown: "Scroll the left sidebar pane down.",
  SidebarPageUp: "Scroll the sidebar up one page.",
  SidebarPageDown: "Scroll the sidebar down one page.",
  SidebarUp: "Scroll the sidebar up one row.",
  SidebarDown: "Scroll the sidebar down one row.",
};

const CONTROL_COMMANDS = new Set([
  "ToggleAlliance",
  "AllToCheer",
  "DeployObject",
  "GuardObject",
  "ScatterObject",
  "StopObject",
  "PlanningMode",
  "ToggleRepair",
  "ToggleSell",
  "PlaceBeacon",
]);

const VIEW_COMMANDS = new Set(["CenterView", "CenterOnRadarEvent", "CenterBase", "Follow"]);

const INTERFACE_COMMANDS = new Set([
  "Options",
  "InfantryTab",
  "StructureTab",
  "UnitTab",
  "DefenseTab",
  "PageUser",
  "TypeSelect",
  "VeterancyNav",
  "PreviousObject",
  "NextObject",
  "CombatantSelect",
  "Delete",
  "ScreenCapture",
  "CursorCheat",
]);

export function hotkeyAction(name: string): string {
  return HOTKEY_LABELS[name] ?? name.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function hotkeyCategory(name: string): string {
  if (/^Team(?:Select|AddSelect|Create|Center)_\d+$/.test(name)) return "Team";
  if (/^Taunt_\d+$/.test(name)) return "Taunt";
  if (/^(?:Set)?View[1-4]$/.test(name)) return "View";
  if (/Sidebar/.test(name)) return "Sidebar";
  if (CONTROL_COMMANDS.has(name)) return "Control";
  if (VIEW_COMMANDS.has(name)) return "View";
  if (INTERFACE_COMMANDS.has(name)) return "Interface";
  return "Other";
}

export function hotkeyDescription(name: string): string {
  const team = /^Team(Select|AddSelect|Create|Center)_(\d+)$/.exec(name);
  if (team) {
    const number = team[2];
    if (team[1] === "TeamSelect") return `Select team ${number}.`;
    if (team[1] === "TeamAddSelect") return `Add team ${number} to the current selection.`;
    if (team[1] === "TeamCreate") return `Assign the current selection to team ${number}.`;
    return `Center the view on team ${number}.`;
  }
  const taunt = /^Taunt_(\d+)$/.exec(name);
  if (taunt) return `Send taunt ${taunt[1]} to your team.`;
  const view = /^(Set)?View([1-4])$/.exec(name);
  if (view)
    return view[1] ? `Save the current view to slot ${view[2]}.` : `Jump to saved view ${view[2]}.`;
  return HOTKEY_DESCRIPTIONS[name] ?? "No description for this command.";
}
