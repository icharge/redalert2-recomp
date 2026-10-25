#pragma once
#include <stdint.h>

/* RA2Web's full handoff is retained for the Internet packet adapter. The COM
 * callback's 32-bit game ID uses the server's decimal g<N>-... instance counter;
 * gserv authentication must use game_id and ticket, never that shortened ID. */
typedef struct {
    char channel[48], gserv_url[256], game_id[64], ticket[128];
    uint32_t timestamp, game_number;
} ra2_wolapi_session;

void ra2_wolapi_register(void);
const ra2_wolapi_session *ra2_wolapi_current_session(void);

/* Guest address of the game's "packet router allowed" byte (Session+0x3038 in
 * Red Alert 2, +0x3090 in Yuri's Revenge), or 0. Once a match has started the
 * bridge keeps it cleared: the game otherwise has the host spawn Westwood's mph.exe
 * packet router and tells the other players to send their frame data through it,
 * which a browser cannot run, so the match would never leave its first frame. With
 * the byte clear every player talks to every other directly, the way a 2 player
 * game without firewall trouble does. */
void ra2_wolapi_set_no_router_flag(uint32_t guest_address);

/* Guest address of the game's IPX manager (the object owning the per-player
 * connections). Internet games match each arriving datagram to a connection by IP
 * and by a port word that the game's own address objects keep but an arriving
 * datagram's never has (it is zero), so no connection would ever receive anything.
 * The bridge zeroes that word in every connection once they exist. */
void ra2_wolapi_set_ipx_manager(uint32_t guest_address);

/* Called from the game thread's message pump; applies the two patches above while
 * a match is being set up or played. The game stops calling into the bridge once it
 * leaves its online screens, so the patches cannot ride on those calls. */
void ra2_wolapi_poll(void);
