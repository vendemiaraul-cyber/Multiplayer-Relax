export function createEmptyInput() {
    return {
        throttle: 0,
        brake: 0,
        steer: 0,
        drift: false,
        useItem: false,
        useItemHeld: false,
        lookBack: false,
        pause: false,
        confirm: false,
        back: false,
        menuUp: false,
        menuDown: false,
        menuLeft: false,
        menuRight: false
    };
}
export const ALL_ITEM_TYPES = [
    'banana',
    'triple_banana',
    'green_shell',
    'triple_green_shell',
    'red_shell',
    'triple_red_shell',
    'blue_shell',
    'mushroom',
    'triple_mushroom',
    'golden_mushroom',
    'star',
    'lightning',
    'bob_omb'
];
