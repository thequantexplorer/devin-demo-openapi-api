export type BookingStatus = 'active' | 'cancelled';

export interface Booking {
  id: string;
  roomId: string;
  guestEmail: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export type NewBooking = Omit<Booking, 'id'>;

/** In-memory storage. Each app instance gets its own store, so tests never share state. */
export class BookingStore {
  private bookings = new Map<string, Booking>();
  private nextId = 1;

  insert(data: NewBooking): Booking {
    const booking: Booking = { id: `bk_${this.nextId++}`, ...data };
    this.bookings.set(booking.id, booking);
    return { ...booking };
  }

  get(id: string): Booking | undefined {
    const booking = this.bookings.get(id);
    return booking ? { ...booking } : undefined;
  }

  update(id: string, changes: Partial<NewBooking>): Booking {
    const booking = this.bookings.get(id);
    if (!booking) throw new Error(`Booking ${id} not found`);
    Object.assign(booking, changes);
    return { ...booking };
  }

  all(): Booking[] {
    return [...this.bookings.values()].map((booking) => ({ ...booking }));
  }
}
