import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Crash } from "./components/Crash";
import { initEngine } from "./engine";
import { initNav } from "./nav";
import "@fontsource-variable/schibsted-grotesk";
import "./styles.css";

initEngine();
initNav();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Crash>
      <App />
    </Crash>
  </StrictMode>,
);
