import { EventEmitter } from "node:events";
import type { Appointment, Contact } from "./types.ts";

export interface AppEvents {
  "contact.created": [Contact];
  "contact.tagged": [Contact, string];
  "appointment.booked": [Appointment];
  "appointment.cancelled": [Appointment];
  "appointment.rescheduled": [Appointment];
  /** Anything the staff UI should refresh for. */
  changed: [{ clinicId: number; kind: string; id?: number }];
}

/** Small typed wrapper around EventEmitter for in-process domain events. */
export class Events {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  on<K extends keyof AppEvents>(event: K, listener: (...args: AppEvents[K]) => void): () => void {
    const wrapped = (...args: unknown[]) => {
      try {
        const result = (listener as (...a: unknown[]) => unknown)(...args);
        if (result instanceof Promise) result.catch((err) => console.error(`[events] ${event}`, err));
      } catch (err) {
        console.error(`[events] ${event}`, err);
      }
    };
    this.emitter.on(event, wrapped);
    return () => this.emitter.off(event, wrapped);
  }

  emit<K extends keyof AppEvents>(event: K, ...args: AppEvents[K]): void {
    this.emitter.emit(event, ...args);
  }
}
