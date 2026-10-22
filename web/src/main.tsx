import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initEngine } from "./engine";
import "@fontsource-variable/schibsted-grotesk";
import "./styles.css";

initEngine();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
