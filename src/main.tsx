import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import Home from "../app/page";
import "../app/styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Gretel could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    <Home />
  </StrictMode>
);
