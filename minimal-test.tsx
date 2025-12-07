import React from "react";
import ReactDOM from "react-dom/client";

function MinimalApp() {
  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h1>Minimal React App</h1>
      <p>This is a minimal React application test.</p>
      <button onClick={() => alert("Button clicked!")}>Click Me</button>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<MinimalApp />);