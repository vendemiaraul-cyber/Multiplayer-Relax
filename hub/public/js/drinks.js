// The DRINK-O-TRON menu: 13 drinks, each with a little effect on your spacer.

export const DRINKS = [
  { id: "coffee", name: "Coffee", color: "#6b4a3a", top: "#c68a5a", cup: "mug", effect: "speed", desc: "Hot and strong. You walk faster for a while." },
  { id: "rocket", name: "Rocket Fuel", color: "#2a1a12", top: "#ff9f43", cup: "shot", effect: "zoom", desc: "Triple espresso. ZOOM. Very jittery." },
  { id: "cocoa", name: "Hot Cocoa", color: "#7a4b2a", top: "#f6f1e7", cup: "mug", effect: "hearts", desc: "Cozy marshmallows. Hearts float around you." },
  { id: "cola", name: "Space Cola", color: "#3a1f14", top: "#d9c3b0", cup: "can", effect: "burp", desc: "Fizzy! May cause a cosmic burp." },
  { id: "nebula", name: "Nebula Tea", color: "#b07cc6", top: "#e7c6f2", cup: "cup", effect: "calm", desc: "The stars outside slow down. Breathe in…" },
  { id: "moonmilk", name: "Moon Milk", color: "#f6f1e7", top: "#ffffff", cup: "mug", effect: "sleepy", desc: "Warm and sleepy. Zzz…" },
  { id: "starjuice", name: "Star Juice", color: "#ff9f43", top: "#ffd166", cup: "glass", effect: "sparkle", desc: "Orange juice squeezed from a star. Sparkly!" },
  { id: "comet", name: "Comet Soda", color: "#4fc3f7", top: "#d6f3ff", cup: "bottle", effect: "hiccup", desc: "Blue soda. Gives you hiccup hops." },
  { id: "galaxy", name: "Galaxy Smoothie", color: "#5b3a8c", top: "#ff8fab", cup: "glass", effect: "rainbow", desc: "Leaves a rainbow trail wherever you walk." },
  { id: "matcha", name: "Matcha Latte", color: "#3fbf7f", top: "#d8f5c8", cup: "mug", effect: "zen", desc: "A calm green zen aura surrounds you." },
  { id: "lemonade", name: "Lemonade", color: "#ffd166", top: "#fff3b0", cup: "glass", effect: "sour", desc: "SOUR!! Your face scrunches right up." },
  { id: "boba", name: "Bubble Tea", color: "#e0b48c", top: "#f6e3cf", cup: "boba", effect: "bubbles", desc: "Chewy pearls. Bubbles everywhere." },
  { id: "water", name: "Water", color: "#9fd8ff", top: "#e8f7ff", cup: "bottle", effect: "hydrate", desc: "Stay hydrated, spacer. +100 HP." },
];

export const drinkById = (id) => DRINKS.find((d) => d.id === id) || null;

/** Draws a drink icon into a 2D context at (x, y) with pixel size s. */
export function drawCup(g, drink, x, y, s = 1, fill = 1) {
  const P = (px, py, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(x + px * s, y + py * s, w * s, h * s);
  };
  const glass = "#cfe9f7", dark = "#2b2d5a", white = "#f6f1e7";
  const level = Math.max(0, Math.min(1, fill));
  switch (drink.cup) {
    case "mug": {
      P(2, 4, 9, 10, white);
      P(11, 6, 3, 1, white); P(13, 6, 1, 5, white); P(11, 10, 3, 1, white);
      const lh = Math.round(7 * level);
      P(3, 5 + (7 - lh), 7, lh, drink.color);
      if (level > 0.8) P(3, 5, 7, 2, drink.top);
      P(2, 14, 9, 1, dark);
      if (drink.effect !== "sleepy") { P(5, 1, 1, 2, "#ffffff88"); P(8, 0, 1, 3, "#ffffff66"); }
      break;
    }
    case "shot":
      P(4, 6, 7, 8, white); P(5, 7, 5, Math.round(6 * level), drink.color); P(5, 7, 5, 1, drink.top);
      P(3, 14, 9, 1, dark);
      P(6, 2, 1, 3, "#ff9f43"); P(8, 1, 1, 4, "#ffd166");
      break;
    case "can":
      P(4, 2, 7, 13, "#d1497f"); P(4, 2, 7, 1, "#8a8fa3"); P(4, 14, 7, 1, "#8a8fa3");
      P(5, 6, 5, 4, white); P(6, 7, 3, 2, drink.color);
      break;
    case "bottle": {
      P(6, 0, 3, 2, "#2d6cdf"); P(6, 2, 3, 2, glass); P(4, 4, 7, 11, glass);
      const lh = Math.round(10 * level);
      P(5, 5 + (10 - lh), 5, lh, drink.color);
      P(5, 8, 5, 2, white);
      break;
    }
    case "boba": {
      P(4, 3, 7, 12, glass);
      const lh = Math.round(11 * level);
      P(5, 4 + (11 - lh), 5, lh, drink.color);
      P(5, 12, 1, 1, dark); P(7, 13, 1, 1, dark); P(9, 12, 1, 1, dark); P(6, 13, 1, 1, dark);
      P(3, 2, 9, 1, "#ff8fab"); P(9, -2, 1, 5, "#ff8fab");
      break;
    }
    case "cup":
      P(2, 7, 11, 6, white); P(3, 13, 9, 1, white); P(1, 14, 13, 1, dark);
      P(3, 7, 9, Math.max(1, Math.round(3 * level)), drink.color);
      P(6, 3, 1, 3, "#ffffff77"); P(9, 2, 1, 3, "#ffffff55");
      break;
    default: {
      // glass
      P(3, 3, 9, 12, glass);
      const lh = Math.round(11 * level);
      P(4, 4 + (11 - lh), 7, lh, drink.color);
      if (level > 0.8) P(4, 4, 7, 2, drink.top);
      P(10, 0, 1, 6, "#ff8fab");
      if (drink.effect === "sour") P(1, 3, 3, 3, "#ffd166");
      break;
    }
  }
}

export function cupCanvas(drink, scale = 3) {
  const c = document.createElement("canvas");
  c.width = c.height = 16 * scale;
  const g = c.getContext("2d");
  drawCup(g, drink, 0, scale * 1, scale, 1);
  return c;
}
