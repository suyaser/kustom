import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button (M14.1)', () => {
  it('calls onClick when not pending', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Roll teams</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Roll teams' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('pending is aria-disabled, never disabled, and swallows the press', () => {
    const onClick = vi.fn();
    render(
      <Button pending onClick={onClick}>
        Rolling…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Rolling…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('data-pending');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps focus while pending (M3.20)', () => {
    const { rerender } = render(<Button onClick={() => {}}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    rerender(
      <Button pending onClick={() => {}}>
        Save
      </Button>,
    );
    expect(document.activeElement).toBe(button);
  });

  it('a pending submit button with onClick does not submit its form', () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
        <Button type="submit" pending onClick={() => {}}>
          Saving…
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a caller cannot clear aria-disabled while pending', () => {
    render(
      <Button pending aria-disabled={false}>
        Saving…
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('attaches no click handler without onClick, so a server component can render it', () => {
    const element = Button({ children: 'Refresh' });
    expect(element.props.onClick).toBeUndefined();
  });
});
