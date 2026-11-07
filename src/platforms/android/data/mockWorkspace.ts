import type { DriveFile } from '../../../data';

export const mockAccounts = [
  { id: 'personal', name: 'Personal', email: 'alex@gmail.com', used: 9.2, total: 15, color: '#9b85d8' },
  { id: 'work', name: 'Work', email: 'alex@studio.design', used: 3.6, total: 15, color: '#a5c5ae' },
];
const file = (id: string, name: string, type: DriveFile['type'], size: string, extra: Partial<DriveFile> = {}): DriveFile =>
  ({ id, name, type, size, account: 'personal', color: 'purple', modified: 'Today', ...extra });
export const mockFiles: DriveFile[] = [
  file('projects', 'Projects', 'folder', '8 files', { items: 8, starred: true }),
  file('photos', 'Photos', 'folder', '24 files', { items: 24, color: 'pink' }),
  file('documents', 'Documents', 'folder', '12 files', { items: 12, color: 'mint' }),
  file('work', 'Studio', 'folder', '6 files', { account: 'work', shared: true, color: 'blue' }),
  file('brand', 'Cirro brand guidelines.pdf', 'pdf', '2.4 MB', { starred: true, offline: true }),
  file('moodboard', 'Weekend moodboard.jpg', 'image', '4.8 MB', { shared: true }),
  file('budget', 'November budget.xlsx', 'sheet', '128 KB', { account: 'work', starred: true, offline: true }),
  file('notes', 'A little room to think.docx', 'doc', '64 KB'),
  file('brief', 'Website brief.pdf', 'pdf', '1.2 MB', { parent: 'projects', account: 'work', shared: true }),
  file('ideas', 'Ideas & explorations.fig', 'design', '8.6 MB', { parent: 'projects' }),
  file('coast', 'A day by the coast.jpg', 'image', '3.2 MB', { parent: 'photos' }),
  file('receipt', 'October receipt.pdf', 'pdf', '240 KB', { parent: 'documents', offline: true }),
  file('deck', 'Studio introduction.pptx', 'slides', '6.4 MB', { parent: 'work', account: 'work', shared: true }),
  file('old', 'Early explorations.fig', 'design', '5.1 MB', { trashed: true, modified: 'Yesterday' }),
];

// This is the Android UI's data boundary. Replace this adapter with a real
// workspace service when Android authentication and storage are implemented.
export const mockWorkspace = { files: mockFiles, accounts: mockAccounts };
