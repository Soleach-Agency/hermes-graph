import React from "react";
import { createRoot } from "react-dom/client";

import { createGraphPage } from "./createGraphPage";
import "./style.css";

const GraphPage = createGraphPage(React as any, { demoOnEmpty: true });
createRoot(document.getElementById("root")!).render(React.createElement(GraphPage));

