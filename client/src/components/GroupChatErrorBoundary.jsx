import { Component } from 'react';

export default class GroupChatErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('[group chat] render failed', error, info?.componentStack);
  }

  render() {
    if (this.state.failed) return <div className="grid h-full place-items-center bg-bg p-6 text-center text-ink">
      <div className="max-w-sm">
        <h2 className="text-lg font-semibold">Couldn’t open this group</h2>
        <p className="mt-2 text-sm text-mute">The group screen hit an error. Reload it or return to your chats.</p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={() => window.location.reload()} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-bg">Reload</button>
          <button onClick={() => { window.location.href = '/'; }} className="rounded-lg bg-panel3 px-4 py-2 text-sm">Back to chats</button>
        </div>
      </div>
    </div>;
    return this.props.children;
  }
}
