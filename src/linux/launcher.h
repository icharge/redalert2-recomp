/* launcher.c: the host plays the launcher the retail and Ares exes look for. */
#pragma once

/* Before the game starts: hold the launcher's mutex and queue its first answer. */
void ra2_launcher_start(void);
/* From the pump hook, on the game's thread: answer the game's signal. */
void ra2_launcher_poll(void);
