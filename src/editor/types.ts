export type Tool = 'select' | 'wall' | 'room' | 'door' | 'work' | 'zoneRect' | 'zoneCircle' | 'spawn' | 'areaRect' | 'areaFill';

/** Editing layer: Build = walls, works, zones, spawn; Areas = floor/ceiling areas only. */
export type Layer = 'build' | 'areas';
export const LAYER_KEY = 'A';

export type Selection =
  | { type: 'wall'; id: string }
  | { type: 'work'; id: string }
  | { type: 'zone'; id: string }
  | { type: 'spawn' }
  | { type: 'area'; id: string }
  | null;

export interface ToolDef { tool: Tool; key: string; label: string; hint: string; layer: Layer }

export const TOOLS: ToolDef[] = [
  { tool: 'select', key: 'V', label: 'Select', hint: 'Click to select; drag empty space to box-select, Shift adds or removes. Drag to move (groups too), arrows nudge, [ ] rotate, Ctrl/Cmd+D duplicates, Delete removes. Moved walls detach from walls they were joined to.', layer: 'build' },
  { tool: 'wall', key: 'W', label: 'Wall', hint: 'Click to chain walls. Esc or right-click ends the chain.', layer: 'build' },
  { tool: 'room', key: 'R', label: 'Room', hint: 'Drag a rectangle to make four walls.', layer: 'build' },
  { tool: 'door', key: 'D', label: 'Door', hint: 'Hover a wall and click to cut a doorway. Paintings in the way are taken down (Undo brings them back).', layer: 'build' },
  { tool: 'work', key: 'H', label: 'Hang', hint: 'Select a painting in the library (or switch on Random painting), then click near a wall face.', layer: 'build' },
  { tool: 'zoneRect', key: 'Z', label: 'Zone', hint: 'Drag a rectangular audio zone.', layer: 'build' },
  { tool: 'zoneCircle', key: 'C', label: 'Circle', hint: 'Drag from the centre for a circular audio zone.', layer: 'build' },
  { tool: 'spawn', key: 'P', label: 'Spawn', hint: 'Click to place the start point; drag to set the facing direction.', layer: 'build' },
];

export const AREA_TOOLS: ToolDef[] = [
  { tool: 'select', key: 'V', label: 'Select', hint: 'Click an area to select it; drag to move, drag a corner to resize; drag empty space to box-select, Shift adds. Delete removes. Ctrl/Cmd+D duplicates.', layer: 'areas' },
  { tool: 'areaRect', key: 'R', label: 'Rect', hint: 'Drag a rectangle to make a floor/ceiling area. Edges snap to wall centre lines and the grid.', layer: 'areas' },
  { tool: 'areaFill', key: 'F', label: 'Fill room', hint: 'Click inside a room to make an area covering it (bounded by the nearest walls).', layer: 'areas' },
];

export const toolsFor = (layer: Layer): ToolDef[] => (layer === 'areas' ? AREA_TOOLS : TOOLS);
