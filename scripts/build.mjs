import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const imageFiles = {
  clear_day: "clear-day.jpg",
  clear_night: "clear-night.jpg",
  cloudy: "cloudy.jpg",
  rain: "rain.jpg",
  snow: "snow.jpg",
  thunderstorm: "thunderstorm.jpg",
};

const backgrounds = Object.fromEntries(Object.entries(imageFiles).map(([condition, filename]) => {
  const bytes = fs.readFileSync(path.join(root, "dist", "backgrounds", filename));
  return [condition, `data:image/jpeg;base64,${bytes.toString("base64")}`];
}));

const source = fs.readFileSync(path.join(root, "src", "weather-channel-card.js"), "utf8");
const placeholder = "__WEATHER_CHANNEL_EMBEDDED_BACKGROUNDS__";
if (!source.includes(placeholder)) throw new Error(`Missing ${placeholder} placeholder`);

const output = source.replace(placeholder, JSON.stringify(backgrounds));
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist", "weather-channel-card.js"), output);
console.log(`Built dist/weather-channel-card.js (${Math.ceil(Buffer.byteLength(output) / 1024)} KiB)`);
