import { describe, it, expect } from 'vitest';
import React from 'react';
import App from '../src/App.js';

describe('Web Dashboard App Smoke Test', () => {
  it('App component should be defined and instantiable', () => {
    expect(App).toBeDefined();
    expect(typeof App).toBe('function');
    const element = React.createElement(App);
    expect(element.type).toBe(App);
  });
});
