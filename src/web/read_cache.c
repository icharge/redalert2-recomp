/*
 * Serve repeated small reads from a bounded Wasm-memory cache. WasmFS's OPFS
 * backend proxies each read to its worker; archive indexes make tens of
 * thousands of tiny ReadFile calls during boot. Once a handle shows that
 * pattern, keep one aligned 1 MiB block for it and serve in-block reads here.
 * The source archives remain in OPFS; at most eight blocks (8 MiB) are cached.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "win32hle.h"

#define READ_CACHE_BLOCK_SIZE (1024u * 1024u)
#define READ_CACHE_SLOTS 8
#define READ_CACHE_TRACKERS 64
#define READ_CACHE_SMALL_LIMIT 128u
#define READ_CACHE_WARM_AFTER 16u

typedef struct {
    int fd;
    unsigned small_reads;
    unsigned eligible; /* 0: unknown, 1: cache read-only regular file, 2: no */
    uint64_t age;
} read_tracker;

typedef struct {
    int fd;
    off_t base;
    size_t length;
    uint64_t age;
    uint8_t *data;
} read_cache_slot;

static read_tracker trackers[READ_CACHE_TRACKERS];
static read_cache_slot slots[READ_CACHE_SLOTS];
static uint64_t cache_age;

static read_tracker *track_fd(int fd) {
    read_tracker *oldest = &trackers[0];
    for (size_t i = 0; i < READ_CACHE_TRACKERS; ++i) {
        if (trackers[i].fd == fd) {
            trackers[i].age = ++cache_age;
            return &trackers[i];
        }
        if (!trackers[i].age) {
            trackers[i].fd = fd;
            trackers[i].age = ++cache_age;
            return &trackers[i];
        }
        if (trackers[i].age < oldest->age) oldest = &trackers[i];
    }
    oldest->fd = fd;
    oldest->small_reads = 0;
    oldest->eligible = 0;
    oldest->age = ++cache_age;
    return oldest;
}

static read_cache_slot *find_slot(int fd, off_t pos, uint32_t length) {
    for (size_t i = 0; i < READ_CACHE_SLOTS; ++i) {
        read_cache_slot *slot = &slots[i];
        if (slot->fd == fd && pos >= slot->base &&
            (uint64_t)(pos - slot->base) + length <= slot->length) {
            slot->age = ++cache_age;
            return slot;
        }
    }
    return NULL;
}

static read_cache_slot *allocate_slot(int fd, off_t base) {
    read_cache_slot *oldest = &slots[0];
    for (size_t i = 0; i < READ_CACHE_SLOTS; ++i) {
        read_cache_slot *slot = &slots[i];
        if (!slot->data || slot->fd == fd) {
            oldest = slot;
            break;
        }
        if (slot->age < oldest->age) oldest = slot;
    }
    if (!oldest->data) {
        oldest->data = malloc(READ_CACHE_BLOCK_SIZE);
        if (!oldest->data) return NULL;
    }
    oldest->fd = fd;
    oldest->base = base;
    oldest->length = 0;
    oldest->age = ++cache_age;
    return oldest;
}

static int warm_slot(int fd, off_t pos, read_tracker *tracker,
                     read_cache_slot **result) {
    if (tracker->eligible == 0) {
        if (tracker->small_reads < READ_CACHE_WARM_AFTER) return 0;
        struct stat st;
        int flags = fcntl(fd, F_GETFL);
        if (flags < 0 || (flags & O_ACCMODE) != O_RDONLY ||
            fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) ||
            st.st_size <= (off_t)READ_CACHE_BLOCK_SIZE) {
            tracker->eligible = 2;
            return 0;
        }
        tracker->eligible = 1;
    }
    if (tracker->eligible != 1) return 0;

    off_t base = pos - pos % (off_t)READ_CACHE_BLOCK_SIZE;
    read_cache_slot *slot = allocate_slot(fd, base);
    if (!slot) return 0;

    size_t wanted = READ_CACHE_BLOCK_SIZE;
    struct stat st;
    if (fstat(fd, &st) != 0 || st.st_size <= base) return 0;
    if ((uint64_t)(st.st_size - base) < wanted)
        wanted = (size_t)(st.st_size - base);

    size_t loaded = 0;
    while (loaded < wanted) {
        ssize_t n = pread(fd, slot->data + loaded, wanted - loaded,
                          base + (off_t)loaded);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        loaded += (size_t)n;
    }
    if (!loaded) return 0;
    slot->length = loaded;
    slot->age = ++cache_age;
    *result = slot;
    return 1;
}

static int cached_read(int fd, uint8_t *buffer, uint32_t length,
                       uint32_t *read_out) {
    if (!length) {
        *read_out = 0;
        return 1;
    }
    off_t pos = lseek(fd, 0, SEEK_CUR);
    if (pos < 0) return 0;

    read_tracker *tracker = track_fd(fd);
    if (length <= READ_CACHE_SMALL_LIMIT && tracker->small_reads < UINT32_MAX)
        tracker->small_reads++;

    read_cache_slot *slot = find_slot(fd, pos, length);
    if (!slot && !warm_slot(fd, pos, tracker, &slot)) return 0;
    if (!slot || pos < slot->base ||
        (uint64_t)(pos - slot->base) + length > slot->length) return 0;

    memcpy(buffer, slot->data + (size_t)(pos - slot->base), length);
    if (lseek(fd, pos + length, SEEK_SET) < 0) return 0;
    slot->age = ++cache_age;
    *read_out = length;
    return 1;
}

void ra2_ReadFile(void) {
    int fd = hle_file_fd(A32(0));
    uint8_t *buffer = (uint8_t *)APTR(1);
    uint32_t length = A32(2);
    uint32_t *read_out = (uint32_t *)APTR(3);
    uint32_t got = 0;
    if (read_out) *read_out = 0;
    if (fd < 0) {
        hle_set_last_error(6); /* ERROR_INVALID_HANDLE */
        RET(0, 5);
    }
    if (cached_read(fd, buffer, length, &got)) {
        if (read_out) *read_out = got;
        RET(1, 5);
    }

    while (got < length) {
        ssize_t n = read(fd, buffer + got, length - got);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        got += (uint32_t)n;
    }
    if (read_out) *read_out = got;
    RET(1, 5); /* EOF is success with zero bytes, matching the normal shim. */
}

void ra2_CloseHandle(void) {
    uint32_t handle = A32(0);
    int fd = hle_file_fd(handle);
    if (fd >= 0) {
        for (size_t i = 0; i < READ_CACHE_TRACKERS; ++i)
            if (trackers[i].fd == fd) trackers[i].fd = -1;
        for (size_t i = 0; i < READ_CACHE_SLOTS; ++i) {
            if (slots[i].fd == fd) {
                free(slots[i].data);
                memset(&slots[i], 0, sizeof slots[i]);
                slots[i].fd = -1;
            }
        }
    }
    if (hle_handle_close(handle) || handle == 0xFFFFFFFFu ||
        handle == 0xFFFFFFFEu || (handle >= 0x11u && handle <= 0x13u))
        RET(1, 1);
    hle_set_last_error(6); /* ERROR_INVALID_HANDLE */
    RET(0, 1);
}
