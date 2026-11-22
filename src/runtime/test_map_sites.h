/* FA2EX Test Map: the addresses test_map_fill.inc writes, per edition (docs/web/test-map.md).
 * Yuri's Revenge is measured from its skirmish dialog; Red Alert 2's are the same code found by
 * instruction alignment and read back from game.exe (each entry names the RA2 instruction). */
#pragma once
#include "recomp_target.h"

#if defined(RA2_TARGET_GAMEMD)
#define TM_SESSION        0x00A8B238u
#define TM_SCEN_PTR       0x00A8B230u
#define TM_FN_DEFAULT_MODE sub_005D5E10
#define TM_FN_MODE_OBJECT sub_005E2F80
#define TM_FN_PICK_MAP    sub_005E7BF0
#define TM_FN_MODE_OFFERS sub_005D63E0
#define TM_FN_SET_STRING  sub_00735090
#define TM_FN_STRING_TEXT sub_00735120
#define TM_FN_SET_COUNTRY sub_0069B760
#define TM_FN_SET_COLOUR  sub_0069B7E0
#define TM_FN_NEW         sub_007C8E17
#define TM_FN_NODE_CTOR   sub_0053ECB0
#define TM_FN_STRCPY      sub_007CA489
#define TM_FN_RANDOMS     sub_0069B8C0
#define TM_MODE_SAVED     0x00A8B3C4u
#define TM_MODE           0x00A8B250u
#define TM_MODE_OBJECT    0x00A8B23Cu
#define TM_MAPS           0x00A8B8CCu
#define TM_MAP_COUNT      0x00A8B8D8u
#define TM_MAP_SAVED      0x00A8B3C8u
#define TM_MAP_INDEX      0x00A8B254u
#define TM_HANDLE         0x00A8B380u
#define TM_COUNTRY        0x00A8B3ACu
#define TM_COLOUR         0x00A8B394u
#define TM_HAS_TEAM_START 1
#define TM_TEAM           0x00A8B39Cu
#define TM_START          0x00A8B3A4u
#define TM_AI_LEVEL       0x00A8B27Cu
#define TM_AI_COUNTRY     0x00A8B29Cu
#define TM_AI_COLOUR      0x00A8B2BCu
#define TM_AI_TEAM        0x00A8B2DCu
#define TM_AI_START       0x00A8B2FCu
#define TM_AI_COUNT       0x00A8B274u
#define TM_AI_REMEMBERED  0x00A8B3ECu
#define TM_RECORD_SIZE    0x85u
#define TM_PLAYERS        0x00A8DA74u
#define TM_SPEED          0x00A8B268u
#define TM_SPEED_LIVE     0x00A8EB60u
#define TM_CREDITS        0x00A8B25Cu
#define TM_UNITS          0x00A8B270u
#define TM_SHORT_GAME     0x00A8B262u
#define TM_SUPERWEAPONS   0x00A8B263u
#define TM_BUILD_OFF_ALLY 0x00A8B264u
#define TM_MCV_REPACKS    0x00A8B320u
#define TM_CRATES         0x00A8B261u
#define TM_FIXED_A        0x00A8B31Fu
#define TM_FIXED_B        0x00A8B260u
#define TM_FIXED_C        0x00A8B31Du
#define TM_FIXED_D        0x00A8B26Cu
#elif defined(RA2_TARGET_GAME)
#define TM_SESSION        0x00A3D298u
#define TM_SCEN_PTR       0x00A3D290u
#define TM_FN_DEFAULT_MODE sub_005B6EC0   /* 0x00684325 */
#define TM_FN_MODE_OBJECT sub_005C34D0    /* 0x00684339 */
#define TM_FN_PICK_MAP    sub_005C7C30    /* 0x0068436B */
#define TM_FN_MODE_OFFERS sub_005B7470    /* 0x00684391 */
#define TM_FN_SET_STRING  sub_006FA0F0    /* 0x006830C6 */
#define TM_FN_STRING_TEXT sub_006FA180    /* 0x00683323 */
#define TM_FN_SET_COUNTRY sub_00672A30    /* 0x006830E1 */
#define TM_FN_SET_COLOUR  sub_00672AE0    /* 0x006832FD */
#define TM_FN_NEW         sub_00782017    /* 0x00683304 */
#define TM_FN_NODE_CTOR   sub_00523410    /* 0x00683319 */
#define TM_FN_STRCPY      sub_00783689    /* 0x0068332A */
#define TM_FN_RANDOMS     sub_00672BB0    /* 0x006833A5 */
#define TM_MODE_SAVED     0x00A3D3D4u
#define TM_MODE           0x00A3D2B0u
#define TM_MODE_OBJECT    0x00A3D29Cu
#define TM_MAPS           0x00A3D8DCu
#define TM_MAP_COUNT      0x00A3D8E8u
#define TM_MAP_SAVED      0x00A3D3D8u
#define TM_MAP_INDEX      0x00A3D2B4u
#define TM_HANDLE         0x00A3D3A0u
#define TM_COUNTRY        0x00A3D3BCu      /* 0x0068332F */
#define TM_COLOUR         0x00A3D3B4u      /* 0x0068333A */
#define TM_HAS_TEAM_START 0                /* RA2's skirmish has no team or start choice */
#define TM_AI_LEVEL       0x00A3D2DCu      /* 0x006831AF */
#define TM_AI_COUNTRY     0x00A3D2FCu      /* 0x006831BD */
#define TM_AI_COLOUR      0x00A3D31Cu      /* 0x006831CF */
#define TM_AI_COUNT       0x00A3D2D4u      /* 0x00682EC7 */
#define TM_AI_REMEMBERED  0x00A3D3FCu      /* 0x006831E3 */
#define TM_RECORD_SIZE    0x75u            /* 0x00683302 */
#define TM_PLAYERS        0x00A3FA7Cu
#define TM_SPEED          0x00A3D2C8u      /* 0x006833D5 */
#define TM_SPEED_LIVE     0x00A40B18u
#define TM_CREDITS        0x00A3D2BCu      /* 0x00683401 */
#define TM_UNITS          0x00A3D2D0u      /* 0x0068341E */
#define TM_SHORT_GAME     0x00A3D2C2u
#define TM_SUPERWEAPONS   0x00A3D2C3u
#define TM_BUILD_OFF_ALLY 0x00A3D2C4u
#define TM_MCV_REPACKS    0x00A3D340u
#define TM_CRATES         0x00A3D2C1u
#define TM_FIXED_A        0x00A3D33Fu      /* 0x00683536 */
#define TM_FIXED_B        0x00A3D2C0u
#define TM_FIXED_C        0x00A3D33Du
#define TM_FIXED_D        0x00A3D2CCu
#else
#error "test_map_sites.h: no address set for this edition"
#endif
