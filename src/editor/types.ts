export type Tool = 'select' | 'wall' | 'room' | 'work' | 'zoneRect' | 'zoneCircle' | 'spawn';

export type Selection =
  | { type: 'wall'; id: string }
  | { type: 'work'; id: string }
  | { type: 'zone'; id: string }
  | { type: 'spawn' }
  | null;

export const TOOLS: { tool: Tool; key: string; label: string; hint: string }[] = [
  { tool: 'select', key: 'V', label: 'Select', hint: 'Click to select; drag walls, endpoints, works, zones. Delete removes.' },
  { tool: 'wall', key: 'W', label: 'Wall', hint: 'Click to chain walls. Esc or right-click ends the chain.' },
  { tool: 'room', key: 'R', label: 'Room', hint: 'Drag a rectangle to make four walls.' },
  { tool: 'work', key: 'H', label: 'Hang', hint: 'Select a painting in the library (or switch on Random painting), then click near a wall face.' },
  { tool: 'zoneRect', key: 'Z', label: 'Zone', hint: 'Drag a rectangular audio zone.' },
  { tool: 'zoneCircle', key: 'C', label: 'Circle', hint: 'Drag from the centre for a circular audio zone.' },
  { tool: 'spawn', key: 'P', label: 'Spawn', hint: 'Click to place the start point; drag to set the facing direction.' },
];
