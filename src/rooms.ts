export interface Room {
  id: string;
  name: string;
  capacity: number;
}

export const rooms: readonly Room[] = [
  { id: 'room-alpha', name: 'Alpha', capacity: 4 },
  { id: 'room-beta', name: 'Beta', capacity: 8 },
  { id: 'room-gamma', name: 'Gamma', capacity: 12 },
];

export function findRoom(id: string): Room | undefined {
  return rooms.find((room) => room.id === id);
}
