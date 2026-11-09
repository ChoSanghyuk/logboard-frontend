import { AppShell, Burger, Group, NavLink, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link, Outlet, useLocation } from 'react-router';

const mainNav = [
  { label: 'Search', to: '/search' },
  { label: 'Errors', to: '/errors' },
  { label: 'Servers', to: '/servers' },
];
const settingsNav = [
  { label: 'LLM endpoints', to: '/settings/llm' },
  { label: 'Prompts', to: '/settings/prompts' },
];

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);

  const link = ({ label, to }: { label: string; to: string }) => (
    <NavLink key={to} component={Link} to={to} label={label} active={isActive(to)} onClick={close} />
  );

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
          <Title order={3}>Logboard</Title>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs" component="nav" aria-label="Main">
        {mainNav.map(link)}
        <NavLink label="Settings" defaultOpened active={isActive('/settings')} variant="subtle">
          {settingsNav.map(link)}
        </NavLink>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
