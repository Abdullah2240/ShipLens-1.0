// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

it('renders JSX under jsdom with Testing Library and jest-dom', () => {
  render(<h1>ok</h1>);
  expect(screen.getByRole('heading')).toBeInTheDocument();
});
