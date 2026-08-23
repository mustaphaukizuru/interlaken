import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from './AvatarUpload';

describe('Avatar', () => {
  it('renders the photo when present, initials otherwise', () => {
    const { rerender } = render(<Avatar user={{ first_name: 'Ana', last_name: 'López', avatar: '/api/v1/accounts/avatar/1/abc/' }} />);
    expect(screen.getByRole('presentation', { hidden: true })).toHaveAttribute('src', '/api/v1/accounts/avatar/1/abc/');
    rerender(<Avatar user={{ first_name: 'Ana', last_name: 'López', avatar: '' }} />);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });
});
