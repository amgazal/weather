import React from "react";
import { createRoot } from "react-dom/client";
import Layer from "./Layer.jsx";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The root element was not found.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <Layer />
  </React.StrictMode>
);
