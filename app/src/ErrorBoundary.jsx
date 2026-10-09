import { Component } from 'react';
export class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="update-required">
        <img src="./brand/las-palmas-logo.png" alt="Las Palmas Rutas" />
        <h1>No pudimos abrir esta pantalla</h1>
        <p>
          Recarga la app para volver a intentarlo. Tus reportes guardados permanecen en este
          teléfono.
        </p>
        <button className="primary-button" onClick={() => location.reload()}>
          Recargar la app
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
