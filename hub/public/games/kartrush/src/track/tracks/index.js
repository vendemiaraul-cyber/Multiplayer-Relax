import { sunnyCircuit } from './sunnyCircuit.js';
import { duneDrift } from './duneDrift.js';
import { frostbiteFalls } from './frostbiteFalls.js';
import { neonNexus } from './neonNexus.js';
import { validateAllTracks } from './validate.js';
export { sunnyCircuit, duneDrift, frostbiteFalls, neonNexus };
export const TRACKS = [
    sunnyCircuit,
    duneDrift,
    frostbiteFalls,
    neonNexus
];
export function getTrackDef(id) {
    return TRACKS.find((t)=>t.id === id) ?? TRACKS[0];
}
if (false) {
    validateAllTracks(TRACKS);
}
