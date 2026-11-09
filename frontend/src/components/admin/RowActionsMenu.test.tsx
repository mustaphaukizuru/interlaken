import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Archive, Trash2, History } from 'lucide-react';
import { RowActionsMenu } from './RowActionsMenu';

const items = (onSelect = vi.fn()) => [
  { key: 'activity', label: 'Ver actividad', icon: History, onSelect },
  { key: 'archive', label: 'Archivar', icon: Archive, onSelect },
  { key: 'delete', label: 'Eliminar', icon: Trash2, danger: true, onSelect },
];

describe('RowActionsMenu', () => {
  it('opens on the first item and moves with the arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    render(<RowActionsMenu label="Más acciones para Ana" items={items()} />);
    const trigger = screen.getByRole('button', { name: 'Más acciones para Ana' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Más acciones para Ana' });
    const [first, second, last] = screen.getAllByRole('menuitem');
    expect(first).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{End}');
    expect(last).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(last).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    expect(menu).toBeInTheDocument();
  });

  it('keeps the destructive item apart, behind a divider', async () => {
    const user = userEvent.setup();
    render(<RowActionsMenu label="Más acciones" items={items()} />);
    await user.click(screen.getByRole('button', { name: 'Más acciones' }));
    const separator = screen.getByRole('separator');
    expect(separator.nextElementSibling).toHaveTextContent('Eliminar');
  });

  it('runs the chosen action and closes', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<RowActionsMenu label="Más acciones" items={items(onSelect)} />);
    await user.click(screen.getByRole('button', { name: 'Más acciones' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archivar' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Esc closes it and gives focus back to the trigger; a click outside closes it', async () => {
    const user = userEvent.setup();
    render(<><p>fuera</p><RowActionsMenu label="Más acciones" items={items()} /></>);
    const trigger = screen.getByRole('button', { name: 'Más acciones' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByText('fuera'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('stays open while the page scrolls and closes once its row leaves the screen', async () => {
    const user = userEvent.setup();
    render(<RowActionsMenu label="Más acciones" items={items()} />);
    const trigger = screen.getByRole('button', { name: 'Más acciones' });
    await user.click(trigger);

    fireEvent.scroll(window);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ top: -120, bottom: -80, left: 0, right: 40, width: 40, height: 40, x: 0, y: -120, toJSON: () => ({}) });
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('renders nothing without items', () => {
    const { container } = render(<RowActionsMenu label="Más acciones" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
