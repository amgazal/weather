import React from "react";
import { createRoot } from "react-dom/client";
import Layer from "./Layer.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Layer />
  </React.StrictMode>
);
