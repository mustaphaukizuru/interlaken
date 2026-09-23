import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Avatar } from './Avatar';

const user = { first_name: 'Admin', last_name: 'Interlaken', avatar: 'https://lh3.googleusercontent.com/a/x=s96-c' };

describe('Avatar', () => {
  it('renders the photo when there is one', () => {
    render(<Avatar user={user} size={40} />);
    expect(screen.getByRole('presentation', { hidden: true })).toHaveAttribute('src', user.avatar);
  });

  it('falls back to initials when the photo fails to load, never to a broken image', () => {
    render(<Avatar user={user} size={40} />);
    fireEvent.error(screen.getByRole('presentation', { hidden: true }));
    expect(screen.queryByRole('presentation', { hidden: true })).toBeNull();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('shows initials when the user has no photo', () => {
    render(<Avatar user={{ ...user, avatar: '' }} size={40} />);
    expect(screen.getByText('AI')).toBeInTheDocument();
  });
});
