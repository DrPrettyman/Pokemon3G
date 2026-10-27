import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// StrictMode is intentionally disabled: Phaser's stateful WebGL game loop
// cannot survive React's double-mount-on-purpose dev behavior. The first mount
// initializes a Phaser.Game; the StrictMode unmount destroys it; async work
// (tweens, async sprite loads, the move animator) still in flight on the
// destroyed scene then throws "null forEach" inside Phaser containers.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
