import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: ''
    };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    let message = 'An unexpected error occurred while rendering this view.';
    if (error instanceof Error) {
      try {
        const parsed = JSON.parse(error.message);
        if (parsed && typeof parsed.error === 'string') {
          message = parsed.error;
        } else {
          message = error.message;
        }
      } catch {
        message = error.message || message;
      }
    } else if (typeof error === 'string') {
      message = error;
    }
    return { hasError: true, errorMessage: message };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    console.error('Uncaught application error:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, errorMessage: '' });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F5F5F7] dark:bg-[#000000] text-[#1D1D1F] dark:text-[#F5F5F7] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/10 rounded-3xl p-7 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#FF3B30]/12 border border-[#FF3B30]/25 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6 text-[#D70015] dark:text-[#FF453A]" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold tracking-tight text-[#1D1D1F] dark:text-white">
                Something went wrong
              </h2>
              <p className="text-xs text-[#6E6E73] dark:text-[#86868B] leading-relaxed break-words">
                {this.state.errorMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full bg-[#0071E3] hover:bg-[#0077ED] text-white font-semibold py-2.5 px-4 rounded-full text-xs transition inline-flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
