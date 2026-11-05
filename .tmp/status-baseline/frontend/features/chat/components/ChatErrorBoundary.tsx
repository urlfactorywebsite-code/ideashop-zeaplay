import React from 'react';

type Props = {
  resetKey?: string | null;
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

class ChatErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previousProps: Props) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error) {
    console.error('chat.render.failed', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100">
          Chat could not render one message. Select another conversation or reload messages to continue.
        </div>
      );
    }

    return this.props.children;
  }
}

export default ChatErrorBoundary;
