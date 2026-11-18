import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

// Optional Adobe Fonts web project (see README). Without it the board uses Helvetica/Arial and Georgia.
const adobeKit = import.meta.env.VITE_ADOBE_FONTS_KIT;
if (adobeKit && /^[a-z0-9]+$/i.test(adobeKit)) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://use.typekit.net/${adobeKit}.css`;
  document.head.append(link);
}

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
