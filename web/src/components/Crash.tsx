import { Component, type ReactNode } from "react";

/** If rendering ever throws, show a way out instead of a blank page. */
export class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>Your songs are still saved on this device. Reloading usually fixes it.</p>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload
        </button>
        <pre>{this.state.error.message}</pre>
      </div>
    );
  }
}
