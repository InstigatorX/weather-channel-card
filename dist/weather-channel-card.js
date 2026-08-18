/* Weather Channel Card v1.1.0 | MIT License */

const weatherChannelScript = [...document.scripts].find(script => script.src.includes("/weather-channel-card.js"));
const weatherChannelBaseUrl = weatherChannelScript
  ? new URL(".", weatherChannelScript.src).href
  : "/hacsfiles/weather-channel-card/";

class WeatherChannelCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._data = null;
    this._error = "";
    this._loading = true;
    this._timer = null;
    this._lastZip = "";
  }

  setConfig(config) {
    if (!config.zip_code && !config.zip_entity) {
      throw new Error("Set zip_code or zip_entity");
    }
    this.config = {
      country_code: "US",
      units: "imperial",
      forecast_hours: 8,
      update_interval: 600,
      ...config,
    };
    this._schedule();
    this._maybeFetch(true);
    this._render();
  }

  set hass(value) {
    this._hass = value;
    this._maybeFetch(false);
    this._render();
  }

  connectedCallback() {
    this._schedule();
    this._maybeFetch(false);
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer);
  }

  getCardSize() { return 9; }
  getGridOptions() { return { columns: 12, rows: 9, min_columns: 6, min_rows: 6 }; }

  _schedule() {
    if (this._timer) clearInterval(this._timer);
    if (!this.config) return;
    const seconds = Math.max(300, Number(this.config.update_interval) || 600);
    this._timer = setInterval(() => this._fetchWeather(), seconds * 1000);
  }

  _zip() {
    const entity = this.config?.zip_entity;
    const entityValue = entity && this._hass?.states?.[entity]?.state;
    return String(entityValue || this.config?.zip_code || "").trim();
  }

  _maybeFetch(force) {
    if (!this.config) return;
    const zip = this._zip();
    if (!zip) return;
    if (force || (!this._fetching && zip !== this._lastZip)) this._fetchWeather();
  }

  async _fetchWeather() {
    if (this._fetching || !this.config) return;
    const zip = this._zip();
    if (!zip) return;
    this._fetching = true;
    this._lastZip = zip;
    this._loading = !this._data;
    this._error = "";
    this._render();
    try {
      const country = encodeURIComponent(this.config.country_code || "US");
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(zip)}&count=1&language=en&format=json&countryCode=${country}`;
      const geoResponse = await fetch(geoUrl);
      if (!geoResponse.ok) throw new Error(`Location lookup failed (${geoResponse.status})`);
      const geo = await geoResponse.json();
      const place = geo.results?.[0];
      if (!place) throw new Error(`No location found for ${zip}`);

      const imperial = this.config.units !== "metric";
      const params = new URLSearchParams({
        latitude: place.latitude,
        longitude: place.longitude,
        current: "temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,is_day,precipitation,rain,weather_code,cloud_cover,surface_pressure,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
        hourly: "temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m",
        daily: "sunrise,sunset,precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min",
        temperature_unit: imperial ? "fahrenheit" : "celsius",
        wind_speed_unit: imperial ? "mph" : "kmh",
        precipitation_unit: imperial ? "inch" : "mm",
        timezone: "auto",
        forecast_days: "2",
      });
      const weatherResponse = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if (!weatherResponse.ok) throw new Error(`Weather request failed (${weatherResponse.status})`);
      this._data = { place, weather: await weatherResponse.json(), zip };
    } catch (error) {
      this._error = error?.message || "Weather could not be loaded";
    } finally {
      this._fetching = false;
      this._loading = false;
      this._render();
    }
  }

  _entity(id) { return id ? this._hass?.states?.[id] : null; }
  _round(value) { return Number.isFinite(Number(value)) ? Math.round(Number(value)) : "—"; }
  _escape(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  _condition(code) {
    if (code === 0) return "Clear";
    if ([1, 2].includes(code)) return "Partly Cloudy";
    if (code === 3) return "Cloudy";
    if ([45, 48].includes(code)) return "Fog";
    if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
    if ([95, 96, 99].includes(code)) return "Thunderstorms";
    return "Unknown";
  }

  _icon(code, isDay = 1) {
    if (code === 0) return isDay ? "☀" : "☾";
    if ([1, 2].includes(code)) return isDay ? "⛅" : "☁";
    if (code === 3) return "☁";
    if ([45, 48].includes(code)) return "≋";
    if (code >= 51 && code <= 57) return "🌦";
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "🌧";
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "❄";
    if (code >= 95) return "⛈";
    return "◌";
  }

  _windDirection(degrees) {
    const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return points[Math.round((Number(degrees) || 0) / 22.5) % 16];
  }

  _hour(iso, now) {
    if (now) return "NOW";
    const value = Number(String(iso).slice(11, 13));
    if (!Number.isFinite(value)) return "—";
    return `${value % 12 || 12}${value < 12 ? "AM" : "PM"}`;
  }

  _background(code, isDay) {
    const groups = this.config?.backgrounds || {};
    let group = isDay ? "clear_day" : "clear_night";
    if (code >= 95) group = "thunderstorm";
    else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) group = "rain";
    else if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) group = "snow";
    else if (code >= 3) group = "cloudy";
    const filenames = { clear_day: "clear-day.jpg", clear_night: "clear-night.jpg", cloudy: "cloudy.jpg", rain: "rain.jpg", snow: "snow.jpg", thunderstorm: "thunderstorm.jpg" };
    const image = groups[group] || this.config?.background_url || `${weatherChannelBaseUrl}backgrounds/${filenames[group]}`;
    const overlay = "linear-gradient(90deg,rgba(3,22,48,.96),rgba(5,35,69,.87) 46%,rgba(7,37,70,.48))";
    let fallback = "linear-gradient(130deg,#04376c,#247fba 60%,#8ecae6)";
    if (group === "thunderstorm") fallback = "linear-gradient(120deg,#07111e,#24364b 52%,#765b73)";
    else if (group === "rain") fallback = "linear-gradient(125deg,#061b32,#254c65 52%,#647986)";
    else if (group === "snow") fallback = "linear-gradient(125deg,#17334f,#7798ad 55%,#d5e6ee)";
    else if (!isDay) fallback = "linear-gradient(130deg,#020817,#102b4d 60%,#3c526d)";
    if (image && /^(https?:\/\/|\/local\/|\/hacsfiles\/)/.test(image)) {
      const safe = encodeURI(image).replace(/["'()\\]/g, char => `%${char.charCodeAt(0).toString(16)}`);
      return `${overlay},url("${safe}") center/cover no-repeat,${fallback}`;
    }
    return fallback;
  }

  _alerts(feels) {
    const alerts = [];
    const official = this._entity(this.config?.alerts_entity);
    if (official && !["0", "none", "unknown", "unavailable", ""].includes(String(official.state).toLowerCase())) {
      const details = official.attributes?.Alerts;
      const first = Array.isArray(details) ? details[0] : null;
      const more = Array.isArray(details) && details.length > 1 ? ` (+${details.length - 1} more)` : "";
      alerts.push({
        type: "official",
        text: first?.Headline || first?.Event
          ? `${first.Headline || first.Event}${more}`
          : official.attributes?.title || official.attributes?.headline || official.attributes?.event || `${official.state} active alert(s)`,
      });
    }
    const lightning = this._entity(this.config?.lightning_entity);
    if (lightning && !["none", "unknown", "unavailable", ""].includes(String(lightning.state).toLowerCase())) {
      alerts.push({ type: "lightning", text: `LIGHTNING ${lightning.state} ${lightning.attributes?.unit_of_measurement || ""} AWAY` });
    }
    const threshold = this.config?.units === "metric" ? 32 : 90;
    if (Number(feels) >= threshold) alerts.push({ type: "heat", text: `HEAT RISK: ${Number(feels) >= (this.config.units === "metric" ? 39 : 103) ? "DANGER" : "EXTREME CAUTION"}` });
    return alerts;
  }

  _render() {
    if (!this.shadowRoot) return;
    if (!this.config || this._loading) {
      this.shadowRoot.innerHTML = `<ha-card><div class="status">Loading local weather…</div></ha-card><style>ha-card{min-height:240px;display:grid;place-items:center}.status{font:600 16px sans-serif}</style>`;
      return;
    }
    if (!this._data) {
      this.shadowRoot.innerHTML = `<ha-card><div class="status error">${this._escape(this._error || "No weather data")}</div></ha-card><style>ha-card{min-height:240px;display:grid;place-items:center}.status{font:600 16px sans-serif;padding:24px}.error{color:var(--error-color,#db4437)}</style>`;
      return;
    }

    const { place, weather, zip } = this._data;
    const current = weather.current || {};
    const hourly = weather.hourly || {};
    const daily = weather.daily || {};
    const imperial = this.config.units !== "metric";
    const degree = imperial ? "°F" : "°C";
    const speed = imperial ? "mph" : "km/h";
    const distance = imperial ? "mi" : "km";
    const precip = imperial ? "in" : "mm";
    const pressure = imperial ? `${(Number(current.surface_pressure) * 0.0295299831).toFixed(2)} in` : `${this._round(current.surface_pressure)} hPa`;
    const visibility = imperial ? (Number(current.visibility) / 1609.344).toFixed(1) : (Number(current.visibility) / 1000).toFixed(1);
    const code = Number(current.weather_code);
    const isDay = Number(current.is_day) === 1;
    const maxHours = Math.min(12, Math.max(4, Number(this.config.forecast_hours) || 8));
    let start = Math.max(0, hourly.time?.findIndex(time => time >= current.time));
    if (start < 0) start = 0;
    const hours = Array.from({ length: maxHours }, (_, offset) => start + offset).filter(index => hourly.time?.[index]).map((index, offset) => `
      <div class="hour"><b>${this._hour(hourly.time[index], offset === 0)}</b><span>${this._icon(Number(hourly.weather_code?.[index]), isDay)}</span><strong>${this._round(hourly.temperature_2m?.[index])}°</strong><small>${this._round(hourly.precipitation_probability?.[index] || 0)}%</small></div>`).join("");
    const alerts = this._alerts(current.apparent_temperature).map(alert => `<div class="alert ${alert.type}">${this._escape(alert.text)}</div>`).join("");
    const location = [place.name, place.admin1].filter(Boolean).join(", ");
    const updated = String(current.time || "").slice(11, 16) || "—";

    this.shadowRoot.innerHTML = `
      <ha-card style="--wx-background:${this._background(code, isDay)}">
        <section class="wx">
          <header><div><div class="place">${this._escape(this.config.title || location)}</div><div class="sub">ZIP ${this._escape(zip)} · Updated ${updated}</div></div><div class="brand">CURRENT CONDITIONS<i>DATA: OPEN-METEO</i></div></header>
          <main><div class="current"><div class="bigicon">${this._icon(code, isDay)}</div><div><div class="temp">${this._round(current.temperature_2m)}<sup>°</sup></div><div class="condition">${this._condition(code)}</div><div class="feels">Feels like ${this._round(current.apparent_temperature)}° · High ${this._round(daily.temperature_2m_max?.[0])}° / Low ${this._round(daily.temperature_2m_min?.[0])}°</div></div></div>
            <div class="facts">
              <div class="fact"><label>HUMIDITY</label><b>${this._round(current.relative_humidity_2m)}%</b></div><div class="fact"><label>DEW POINT</label><b>${this._round(current.dew_point_2m)}${degree}</b></div>
              <div class="fact"><label>WIND</label><b>${this._windDirection(current.wind_direction_10m)} ${this._round(current.wind_speed_10m)} ${speed}</b></div><div class="fact"><label>GUSTS</label><b>${this._round(current.wind_gusts_10m)} ${speed}</b></div>
              <div class="fact"><label>PRESSURE</label><b>${pressure}</b></div><div class="fact"><label>VISIBILITY</label><b>${visibility} ${distance}</b></div>
              <div class="fact"><label>RAINFALL TODAY</label><b>${daily.precipitation_sum?.[0] ?? "—"} ${precip}</b></div><div class="fact"><label>RAIN CHANCE</label><b>${daily.precipitation_probability_max?.[0] ?? "—"}%</b></div>
            </div></main>
          <footer>${alerts}${this._error ? `<div class="notice">Refresh failed: ${this._escape(this._error)} · showing previous data</div>` : ""}<div class="hourly" style="--hours:${maxHours}">${hours}</div></footer>
        </section>
      </ha-card>
      <style>
        :host{display:block}ha-card{overflow:hidden;border:0;background:var(--wx-background);color:#fff;text-shadow:0 2px 5px #001a}.wx{box-sizing:border-box;position:relative;min-height:min(78vh,56.25vw);aspect-ratio:16/9;padding:clamp(18px,3vw,54px);display:grid;grid-template-rows:auto 1fr auto;gap:clamp(14px,2vw,30px);font-family:Inter,Roboto,Arial,sans-serif}
        header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #ffffff55;padding-bottom:1.1vw}.place{font-size:clamp(18px,2.1vw,38px);font-weight:800}.sub{font-size:clamp(10px,.85vw,15px);opacity:.78;margin-top:5px}.brand{text-align:right;font-weight:900;font-size:clamp(13px,1.15vw,22px);letter-spacing:.08em}.brand i{display:block;font-size:.62em;font-style:normal;font-weight:500;opacity:.72;margin-top:6px}
        main{display:grid;grid-template-columns:1.05fr .95fr;align-items:center;gap:5vw}.current{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:2.4vw}.bigicon{font-size:clamp(72px,11vw,190px);filter:drop-shadow(0 5px 8px #0018)}.temp{font-size:clamp(88px,13vw,230px);font-weight:300;line-height:.76;letter-spacing:-.08em}.temp sup{font-size:.42em;vertical-align:top;margin-left:.06em}.condition{font-size:clamp(22px,2.6vw,48px);font-weight:700;margin-top:1.4vw}.feels{font-size:clamp(13px,1.25vw,23px);opacity:.85;margin-top:.5vw}
        .facts{display:grid;grid-template-columns:repeat(2,1fr);border-left:1px solid #ffffff55}.fact{padding:clamp(10px,1.2vw,22px) clamp(12px,1.7vw,30px);border-bottom:1px solid #ffffff38}.fact:nth-last-child(-n+2){border-bottom:0}.fact label{display:block;font-size:clamp(10px,.8vw,14px);letter-spacing:.12em;opacity:.7}.fact b{display:block;font-size:clamp(18px,1.75vw,32px);margin-top:5px}
        footer{align-self:end}.alert,.notice{color:#121212;text-shadow:none;font-size:clamp(10px,.9vw,17px);font-weight:900;letter-spacing:.06em;padding:clamp(7px,.7vw,12px) 1.1vw;margin-bottom:1vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.official{background:#f5a000}.lightning{background:#8d6ddb;color:#fff}.heat{background:#e55a28;color:#fff}.notice{background:#ffffffd8;font-weight:700}
        .hourly{display:grid;grid-template-columns:repeat(var(--hours),minmax(0,1fr));background:#031b31b8;border-top:1px solid #ffffff55;backdrop-filter:blur(9px)}.hour{text-align:center;padding:clamp(8px,1vw,18px) 4px;border-right:1px solid #ffffff26;display:grid;gap:.35vw}.hour:last-child{border:0}.hour b{font-size:clamp(9px,.75vw,14px);opacity:.82}.hour strong{font-size:clamp(17px,1.8vw,33px)}.hour small{color:#82cfff;font-size:clamp(9px,.72vw,13px)}.hour span{font-size:clamp(20px,2.2vw,40px);line-height:1.1}
        @media(max-width:760px),(max-aspect-ratio:4/3){.wx{aspect-ratio:auto;min-height:100vh;padding:18px}main{grid-template-columns:1fr;gap:24px}.current{justify-content:center}.facts{border-left:0;border-top:1px solid #ffffff55}.hourly{overflow-x:auto;grid-template-columns:repeat(var(--hours),minmax(72px,1fr))}.temp{font-size:100px}.bigicon{font-size:78px}header{padding-bottom:12px}}
      </style>`;
  }
}

if (!customElements.get("weather-channel-card")) customElements.define("weather-channel-card", WeatherChannelCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "weather-channel-card",
  name: "Weather Channel Card",
  description: "Responsive current conditions and hourly forecast by ZIP code",
  preview: true,
});

console.info("%c WEATHER-CHANNEL-CARD %c v1.1.0 ", "color:#fff;background:#1261a0;font-weight:700", "color:#1261a0;background:#fff");
