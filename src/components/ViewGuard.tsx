import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/button";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ViewGuard extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("FormTopo view error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-fg">The map hit a bad reading and stopped drawing.</p>
        <p className="max-w-sm text-xs text-muted">
          Your points are still saved on this device. Reset the view to keep working.
        </p>
        <Button size="sm" onClick={() => this.setState({ error: null })}>
          Redraw
        </Button>
      </div>
    );
  }
}
