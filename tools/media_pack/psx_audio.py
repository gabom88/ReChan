"""PSX SPU ADPCM decoding for ReChan media packs.

Exact ports of the engine's decoders (src/snd/adpcm.h, RsdFormat::LoadFag in
src/snd/rsdformat.h, dialog layout from ExportDialogWavs in
src/extra/assetexporter.cpp), so the converted audio matches what the game
itself would play.
"""
from __future__ import annotations

import struct
from array import array

FILTER_POS = (0, 60, 115, 98, 122)
FILTER_NEG = (0, 0, -52, -55, -60)

# 4-bit nibble -> signed value
_NIB = tuple(n - 16 if n >= 8 else n for n in range(16))


def decode_block(block: bytes, offset: int, out: array, prev0: int, prev1: int):
    """Decode one 16-byte block (28 samples) appended to `out`.
    Returns (prev0, prev1, end_flag)."""
    shift_filter = block[offset]
    flags = block[offset + 1]
    shift = shift_filter & 0x0F
    filt = (shift_filter >> 4) & 0x0F
    if filt > 4:
        filt = 4
    if shift > 12:
        shift = 12
    f0 = FILTER_POS[filt]
    f1 = FILTER_NEG[filt]
    append = out.append
    nib = _NIB
    for i in range(14):
        byte = block[offset + 2 + i]
        for nibble in (nib[byte & 0x0F], nib[byte >> 4]):
            sample = ((nibble << 12) >> shift) + ((prev0 * f0 + prev1 * f1 + 32) >> 6)
            if sample > 32767:
                sample = 32767
            elif sample < -32768:
                sample = -32768
            append(sample)
            prev1 = prev0
            prev0 = sample
    return prev0, prev1, (flags & 1) != 0


def decode(data: bytes, stop_at_end: bool = False) -> array:
    """SpuAdpcm::Decode: whole stream, one filter state."""
    out = array('h')
    prev0 = prev1 = 0
    for off in range(0, len(data) - len(data) % 16, 16):
        prev0, prev1, end = decode_block(data, off, out, prev0, prev1)
        if end and stop_at_end:
            break
    return out


# ---------------------------------------------------------------- FAG music

FAG_CHUNK_BLOCKS = 2048
FAG_CHUNK_BYTES = FAG_CHUNK_BLOCKS * 16  # 32 KB
FAG_RATE = 22050                          # Sound::PSX_MUSIC_RATE


def fag_song_ranges(data: bytes):
    """[(start, end)] byte ranges of each song, as RsdFormat::LoadFag reads them."""
    if len(data) < 4:
        return []
    num = struct.unpack_from('<I', data, 0)[0]
    if num == 0 or num > 64 or len(data) < 4 + num * 8:
        return []
    starts = struct.unpack_from('<%dI' % num, data, 4)
    ends = struct.unpack_from('<%dI' % num, data, 4 + num * 4)
    out = []
    for s, e in zip(starts, ends):
        e = min(e, len(data))
        out.append((s, e) if (s < len(data) and e > s) else None)
    return out


def decode_fag_song(data: bytes, start: int, end: int) -> array:
    """Interleaved stereo s16 PCM (L,R,...) for one song: 32 KB chunks alternate
    L/R and the filter state resets at every chunk (RsdFormat::LoadFag)."""
    size = end - start
    num_chunks = (size // 16) // FAG_CHUNK_BLOCKS
    num_pairs = num_chunks // 2
    pcm = array('h')
    for p in range(num_pairs):
        left = array('h')
        right = array('h')
        for ch, buf in ((0, left), (1, right)):
            base = start + (p * 2 + ch) * FAG_CHUNK_BYTES
            prev0 = prev1 = 0
            for b in range(FAG_CHUNK_BLOCKS):
                prev0, prev1, _ = decode_block(data, base + b * 16, buf, prev0, prev1)
        inter = array('h', bytes(len(left) * 4))
        inter[0::2] = left
        inter[1::2] = right
        pcm.extend(inter)
    return pcm


def zero_fag_audio(data: bytearray) -> None:
    """Blank every song's ADPCM payload (header kept, size unchanged)."""
    for r in fag_song_ranges(bytes(data)):
        if r:
            data[r[0]:r[1]] = bytes(r[1] - r[0])


# ------------------------------------------------------- RSDIALOG.DLG speech

DIALOG_SECTOR = 2048
DIALOG_RATE = 11025


def dialog_clips(data: bytes):
    """Yield (name, start, size) for every clip, named like the engine's
    dialog overrides: cCC_dDDD_vVV (character, dialog id, variant)."""
    if len(data) < 6:
        return
    header_size, char_count = struct.unpack_from('<HH', data, 0)
    data_base = (header_size + DIALOG_SECTOR - 1) & ~(DIALOG_SECTOR - 1)
    if header_size < 4 + char_count * 2 or data_base >= len(data):
        return
    for character in range(char_count):
        info = struct.unpack_from('<H', data, 4 + character * 2)[0]
        if info >= header_size:
            continue
        count = data[info]
        dialog_list = info + 1
        stream_table = dialog_list + count
        clip_table = stream_table + count * 2
        if clip_table + count * 2 > header_size:
            continue
        for d in range(count):
            dialog_id = data[dialog_list + d]
            stream_sector = struct.unpack_from('<H', data, stream_table + d * 2)[0]
            clip_info = struct.unpack_from('<H', data, clip_table + d * 2)[0]
            if clip_info >= header_size:
                continue
            clip_count = data[clip_info]
            if clip_info + 1 + clip_count > header_size:
                continue
            clip_start = data_base + stream_sector * DIALOG_SECTOR
            for variant in range(clip_count):
                sectors = data[clip_info + 1 + variant] & 0x3F
                size = sectors * DIALOG_SECTOR
                if size and clip_start + size <= len(data):
                    yield ('c%02d_d%03d_v%02d' % (character, dialog_id, variant), clip_start, size)
                clip_start += size


def zero_dialog_audio(data: bytearray) -> None:
    """Blank all speech after the header (the engine still reads the header
    to locate clips; the clips themselves come from the media pack)."""
    if len(data) < 6:
        return
    header_size = struct.unpack_from('<H', data, 0)[0]
    data_base = (header_size + DIALOG_SECTOR - 1) & ~(DIALOG_SECTOR - 1)
    if data_base < len(data):
        data[data_base:] = bytes(len(data) - data_base)


def wav_bytes(pcm: array, rate: int, channels: int) -> bytes:
    raw = pcm.tobytes()  # little-endian on all supported PCs
    return (b'RIFF' + struct.pack('<I', 36 + len(raw)) + b'WAVEfmt ' +
            struct.pack('<IHHIIHH', 16, 1, channels, rate, rate * channels * 2, channels * 2, 16) +
            b'data' + struct.pack('<I', len(raw)) + raw)
