class Heap {
    constructor(compare) {
        this.compare = compare;
        this.items = [];
    }

    push(item) {
        this.items.push(item);
        this.bubbleUp(this.items.length - 1);
    }

    pop() {
        if (!this.items.length) return undefined;
        const first = this.items[0];
        const last = this.items.pop();
        if (this.items.length) {
            this.items[0] = last;
            this.bubbleDown(0);
        }
        return first;
    }

    remove(item) {
        const index = this.items.indexOf(item);
        if (index < 0) return false;
        const last = this.items.pop();
        if (index < this.items.length) {
            this.items[index] = last;
            this.bubbleUp(index);
            this.bubbleDown(index);
        }
        return true;
    }

    toArray() {
        return [...this.items];
    }

    bubbleUp(start) {
        let index = start;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.compare(this.items[index], this.items[parent]) >= 0) break;
            [this.items[index], this.items[parent]] = [this.items[parent], this.items[index]];
            index = parent;
        }
    }

    bubbleDown(start) {
        let index = start;
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            let smallest = index;
            if (left < this.items.length && this.compare(this.items[left], this.items[smallest]) < 0) smallest = left;
            if (right < this.items.length && this.compare(this.items[right], this.items[smallest]) < 0) smallest = right;
            if (smallest === index) break;
            [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
            index = smallest;
        }
    }
}

class EventQueue {
    constructor() {
        this.minHeap = new Heap((a, b) => a.time - b.time);
    }

    addEvent(event) {
        this.minHeap.push(event);
    }

    getNextEvent() {
        return this.minHeap.pop();
    }

    containsEventOfType(type) {
        let heapEvents = this.minHeap.toArray();

        return heapEvents.some((event) => event.type == type);
    }

    containsEventOfTypeAndHrid(type, hrid) {
        let heapEvents = this.minHeap.toArray();
        return heapEvents.some((event) => event.type == type && event.hrid == hrid);
    }

    clear() {
        this.minHeap = new Heap((a, b) => a.time - b.time);
    }

    clearEventsForUnit(unit) {
        this.clearMatching((event) => event.source == unit || event.target == unit);
    }

    clearEventsOfType(type) {
        this.clearMatching((event) => event.type == type);
    }

    clearMatching(fn) {
        let cleared = false;
        let heapEvents = this.minHeap.toArray();

        for (const event of heapEvents) {
            if (fn(event)) {
                this.minHeap.remove(event);
                cleared = true;
            }
        }
        return cleared;
    }

    getMatching(fn) {
        let heapEvents = this.minHeap.toArray(); 
    
        for (const event of heapEvents) {
            if (fn(event)) {
                return event; 
            }
        }
    
        return null; 
    }
}

export default EventQueue;
