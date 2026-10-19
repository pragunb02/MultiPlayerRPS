import { createSeatIds } from "../domain/rooms/seatIds.js";

/**
 * Real seat ids under a key for tests only (CC-253). Tests that read a room view work out the seat id they expect
 * with `seatIdOf`, the same way the room component does.
 */
export const TEST_SEAT_IDS = createSeatIds({ secret: "seat-secret-for-tests-only-0123456789abcdef" });
