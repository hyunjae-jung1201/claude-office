import sys
out = sys.argv[1]

STATE = {'read':'#4c8dff','write':'#13a58a','run':'#8b5cf6','wait':'#f5a524','rest':'#8a94a6'}
INK = '#1d2540'

DEFS = f'''
<defs>
  <filter id="sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#1d2540" flood-opacity=".22"/></filter>
  <filter id="sh2" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3.5" flood-color="#1d2540" flood-opacity=".28"/></filter>
  <symbol id="p" viewBox="0 0 40 64" overflow="visible">
    <ellipse cx="20" cy="61" rx="14" ry="3.2" fill="#1d2540" opacity=".18"/>
    <rect x="12.5" y="44" width="6.5" height="16" rx="3.2" fill="#2b3350"/>
    <rect x="21" y="44" width="6.5" height="16" rx="3.2" fill="#2b3350"/>
    <rect x="3.5" y="27" width="7" height="17" rx="3.5" fill="currentColor"/>
    <rect x="29.5" y="27" width="7" height="17" rx="3.5" fill="currentColor"/>
    <rect x="8.5" y="24" width="23" height="25" rx="9" fill="currentColor"/>
    <rect x="8.5" y="40" width="23" height="9" rx="4" fill="#000" opacity=".12"/>
    <circle cx="20" cy="15" r="11.5" fill="var(--skin,#f2c7a5)"/>
    <path d="M8 15 a12 12 0 0 1 24 0 q-3 -5 -12 -5.5 q-9 .5 -12 5.5z" fill="var(--hair,#2a2236)"/>
    <circle cx="16" cy="17" r="1.5" fill="#2a2236"/><circle cx="24" cy="17" r="1.5" fill="#2a2236"/>
    <path d="M17.5 21.5 q2.5 2 5 0" stroke="#a5604a" stroke-width="1.2" fill="none" stroke-linecap="round"/>
  </symbol>
  <pattern id="tile" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="none"/><path d="M24 0H0V24" fill="none" stroke="#1d2540" stroke-opacity=".05"/></pattern>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfd6f2"/><stop offset="1" stop-color="#eaf1fa"/></linearGradient>
</defs>
<style>
  .bob{{animation:bob 2.4s ease-in-out infinite}}
  .bob2{{animation:bob 2.9s ease-in-out infinite .6s}}
  .bob3{{animation:bob 2.6s ease-in-out infinite 1.1s}}
  .led{{animation:led 1.6s steps(2) infinite}}
  .led2{{animation:led 1.1s steps(2) infinite .4s}}
  @keyframes bob{{50%{{transform:translateY(-2.5px)}}}}
  @keyframes led{{50%{{opacity:.25}}}}
  @media (prefers-reduced-motion:reduce){{.bob,.bob2,.bob3,.led,.led2{{animation:none}}}}
  svg text{{font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif}}
</style>
'''

def avatar(x, y, shirt, hair, name, cls='bob', scale=1.0):
    """x,y = feet center."""
    w, h = 40*scale, 64*scale
    s = f'<g class="{cls}"><use href="#p" x="{x-w/2:.1f}" y="{y-h+3*scale:.1f}" width="{w:.1f}" height="{h:.1f}" style="color:{shirt};--hair:{hair}"/></g>'
    tw = len(name)*7.2+26
    s += f'<g filter="url(#sh)"><rect x="{x-tw/2:.1f}" y="{y+5:.1f}" width="{tw:.1f}" height="19" rx="9.5" fill="#fff"/></g>'
    s += f'<circle cx="{x-tw/2+10:.1f}" cy="{y+14.5:.1f}" r="4" fill="{shirt}"/>'
    s += f'<text x="{x-tw/2+19:.1f}" y="{y+18.5:.1f}" font-size="11" font-weight="600" fill="{INK}">{name}</text>'
    return s

def bubble(cx, ybottom, text, kind):
    col = STATE[kind]
    w = len(text)*12.2 + 40
    x = cx - w/2
    y = ybottom - 30
    s = f'<g filter="url(#sh)"><rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="28" rx="14" fill="#fff"/>'
    s += f'<path d="M{cx-6:.1f} {ybottom-2.5:.1f} L{cx:.1f} {ybottom+5:.1f} L{cx+6:.1f} {ybottom-2.5:.1f}z" fill="#fff"/></g>'
    s += f'<circle cx="{x+15:.1f}" cy="{y+14:.1f}" r="5.5" fill="{col}"/><circle cx="{x+15:.1f}" cy="{y+14:.1f}" r="9" fill="{col}" opacity=".18"/>'
    s += f'<text x="{x+28:.1f}" y="{y+18.3:.1f}" font-size="12.5" font-weight="600" fill="{INK}">{text}</text>'
    return s

def pill(x, y, text, fill='#ffffff', color=INK):
    w = len(text)*12.5+22
    return f'<rect x="{x}" y="{y}" width="{w:.1f}" height="22" rx="11" fill="{fill}" opacity=".92"/><text x="{x+11}" y="{y+15}" font-size="12" font-weight="700" fill="{color}">{text}</text>'

P1 = ('#e8637a', '#3b2a2a', 'ArucoTracker')
P2 = ('#2a7f8f', '#1f2230', 'Dashboard')
P3 = ('#8fb339', '#5a3b22', 'T.W Cam')

# ---------------- A: top-down-ish 2D ----------------
def scene_a():
    s = '<svg viewBox="0 0 800 470" width="100%" role="img" aria-label="위에서 본 2D 사무실">'
    s += DEFS
    s += '<rect width="800" height="470" rx="18" fill="#c9d3e0"/>'
    s += '<rect x="10" y="10" width="780" height="450" rx="14" fill="#f3f6fa"/>'
    def room(x,y,w,h,fill,label,lc):
        r = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}"/><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="url(#tile)"/>'
        r += f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="none" stroke="#9fb0c6" stroke-width="2.5"/>'
        r += pill(x+12, y+10, label, '#ffffff', lc)
        return r
    # rooms
    s += room(24,24,236,172,'#e3ebf7','자료실','#2f63c7')
    s += room(272,24,256,172,'#eef1f5','작업실','#0e7a67')
    s += room(540,24,236,172,'#e9e6f6','서버실','#6a3fd1')
    s += room(24,208,372,242,'#f6ecd9','회의실','#a36a0a')
    s += room(408,208,368,242,'#e5f1e8','휴게실','#3d7a52')
    # bookshelves
    cols = ['#4c8dff','#f26b6b','#f5a524','#13a58a','#8b5cf6','#e8637a']
    for row,yy in enumerate((52,100)):
        s += f'<rect x="40" y="{yy+14}" width="204" height="36" rx="4" fill="#a9733f"/>'
        bx = 46
        i = 0
        while bx < 236:
            bw = 7+((i*5)%6)
            bh = 22+((i*7)%11)
            s += f'<rect x="{bx}" y="{yy+14+36-4-bh}" width="{bw}" height="{bh}" rx="1.5" fill="{cols[(i+row)%6]}"/>'
            bx += bw+2; i += 1
        s += f'<rect x="40" y="{yy+46}" width="204" height="6" rx="3" fill="#8a5a2d"/>'
    # reading table
    s += '<rect x="90" y="150" width="104" height="30" rx="8" fill="#d8b98a" filter="url(#sh)"/><rect x="104" y="156" width="34" height="18" rx="3" fill="#fff"/><rect x="146" y="156" width="34" height="18" rx="3" fill="#fff"/>'
    # desks in work room
    for i,dx in enumerate((292,382,452)):
        pass
    for dx in (296, 408):
        s += f'<rect x="{dx}" y="124" width="96" height="46" rx="8" fill="#d8b98a" filter="url(#sh)"/>'
        s += f'<rect x="{dx+30}" y="100" width="36" height="26" rx="4" fill="#26304d"/><rect x="{dx+33}" y="103" width="30" height="18" rx="2" fill="#7fe0c8" opacity=".85"/>'
        s += f'<rect x="{dx+42}" y="126" width="12" height="4" rx="2" fill="#8795b3"/>'
    # server racks
    for i in range(4):
        rx = 560+i*52
        s += f'<rect x="{rx}" y="52" width="40" height="112" rx="6" fill="#2a3150" filter="url(#sh)"/>'
        for j in range(6):
            yy = 62+j*17
            s += f'<rect x="{rx+5}" y="{yy}" width="30" height="11" rx="2.5" fill="#3a4470"/>'
            c = '#35e0a1' if (i+j)%3 else '#8b5cf6'
            s += f'<circle class="{"led" if (i+j)%2 else "led2"}" cx="{rx+11}" cy="{yy+5.5}" r="2.2" fill="{c}"/>'
    # meeting table
    s += '<rect x="96" y="276" width="212" height="86" rx="43" fill="#c99a5b" filter="url(#sh2)"/><rect x="104" y="284" width="196" height="70" rx="35" fill="#d9ac6e"/>'
    s += '<rect x="170" y="308" width="64" height="22" rx="4" fill="#fff"/><path d="M178 322 l10 -8 l10 5 l12 -9 l14 8" stroke="#13a58a" stroke-width="2" fill="none"/>'
    for cx_,cy_ in ((120,262),(200,256),(280,262),(120,378),(200,384),(280,378)):
        s += f'<rect x="{cx_-14}" y="{cy_-6}" width="28" height="16" rx="7" fill="#7a8bb0"/>'
    # whiteboard
    s += '<rect x="316" y="226" width="60" height="8" rx="2" fill="#fff" stroke="#c6a36b"/>'
    # lounge
    s += '<rect x="430" y="276" width="150" height="54" rx="16" fill="#3d9b7d" filter="url(#sh2)"/><rect x="436" y="258" width="138" height="26" rx="12" fill="#2f8268"/>'
    s += '<rect x="480" y="352" width="60" height="30" rx="14" fill="#d8b98a" filter="url(#sh)"/><circle cx="500" cy="366" r="6" fill="#fff"/><path d="M505 360 q5 -8 0 -12" stroke="#8a94a6" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
    s += '<circle cx="728" cy="420" r="22" fill="#3d9b7d"/><circle cx="716" cy="410" r="11" fill="#4fb08f"/><circle cx="738" cy="412" r="10" fill="#2f8268"/><rect x="720" y="426" width="16" height="14" rx="3" fill="#a9733f"/>'
    s += '<rect x="640" y="236" width="110" height="24" rx="6" fill="#c9d9ce"/><circle cx="660" cy="248" r="6" fill="#8a94a6"/><rect x="676" y="244" width="62" height="8" rx="4" fill="#fff"/>'
    s += '<text x="694" y="271" font-size="10" fill="#4b5c52" text-anchor="middle">커피 머신</text>'
    # walking path
    s += '<path d="M360 190 C 380 230, 330 250, 300 262" stroke="#4c8dff" stroke-width="2.5" stroke-dasharray="2 8" stroke-linecap="round" fill="none" opacity=".7"/>'
    # characters
    s += avatar(380,172,*P1[:2],P1[2])
    s += bubble(380,98,'코드 쓰는 중','write')
    s += avatar(620,170,*P2[:2],P2[2],'bob2')
    s += bubble(620,100,'테스트 실행 중','run')
    s += avatar(204,352,*P3[:2],P3[2],'bob3')
    s += bubble(204,278,'승인 기다리는 중','wait')
    s += '</svg>'
    return s

# ---------------- B: cutaway building ----------------
def scene_b():
    H = 140; GAP = 26; X0 = 76; RW = 316
    ys = [66, 66+H+GAP, 66+2*(H+GAP)]
    total = ys[2]+H+30
    s = f'<svg viewBox="0 0 800 {total}" width="100%" role="img" aria-label="옆에서 본 단면 건물">'
    s += DEFS
    s += f'<rect width="800" height="{total}" rx="18" fill="url(#sky)"/>'
    for cx_,cy_,r in ((90,50,1),(700,40,1.2),(660,100,.8)):
        s += f'<g opacity=".9" transform="translate({cx_} {cy_}) scale({r})"><ellipse cx="0" cy="0" rx="34" ry="11" fill="#fff"/><ellipse cx="-18" cy="-6" rx="20" ry="10" fill="#fff"/><ellipse cx="14" cy="-8" rx="18" ry="10" fill="#fff"/></g>'
    s += f'<rect x="60" y="40" width="680" height="{total-60}" rx="10" fill="#2b3350" filter="url(#sh2)"/>'
    s += '<rect x="52" y="28" width="696" height="20" rx="8" fill="#1d2540"/>'
    plan = [
      ('3F', [('자료실','#dfe8f8','#2f63c7'),('서버실','#e6e2f6','#6a3fd1')]),
      ('2F', [('작업실','#e1f1ec','#0e7a67'),('회의실','#f6ecd9','#a36a0a')]),
      ('1F', [('휴게실','#e3f0e6','#3d7a52'),('로비','#eef0f4','#4a5775')]),
    ]
    cols = ['#4c8dff','#f26b6b','#f5a524','#13a58a','#8b5cf6','#e8637a']
    for y, (fl, rooms) in zip(ys, plan):
        fb = y+H-14
        for i,(nm,fill,lc) in enumerate(rooms):
            x = X0 + i*(RW+16)
            s += f'<rect x="{x}" y="{y}" width="{RW}" height="{H}" rx="6" fill="{fill}"/>'
            s += f'<rect x="{x}" y="{fb}" width="{RW}" height="14" fill="#c7ae86"/><rect x="{x}" y="{fb}" width="{RW}" height="3" fill="#a9916a"/>'
            s += pill(x+10, y+9, nm, '#ffffff', lc)
        s += f'<text x="724" y="{y+16}" font-size="11" font-weight="700" fill="#8e9bbb" text-anchor="end">{fl}</text>'
        # windows (right edge of each room)
        for x in (X0+RW-80, X0+RW+16+RW-80):
            s += f'<rect x="{x}" y="{y+34}" width="58" height="40" rx="4" fill="#cfe2f7" stroke="#fff" stroke-width="3"/><path d="M{x+29} {y+34} v40 M{x} {y+54} h58" stroke="#fff" stroke-width="2"/>'
    y3, y2, y1 = ys
    fb3, fb2, fb1 = y3+H-14, y2+H-14, y1+H-14
    # 3F bookshelf
    s += f'<rect x="90" y="{fb3-84}" width="150" height="84" rx="4" fill="#a9733f"/>'
    i=0
    for rowtop in (fb3-80, fb3-40):
        bx=96
        while bx<232:
            bw=7+((i*5)%6); bh=22+((i*7)%9)
            s += f'<rect x="{bx}" y="{rowtop+34-bh}" width="{bw}" height="{bh}" rx="1.5" fill="{cols[i%6]}"/>'
            bx+=bw+2;i+=1
        s += f'<rect x="90" y="{rowtop+34}" width="150" height="4" fill="#8a5a2d"/>'
    # 3F server racks
    for i in range(3):
        rx = 530+i*52
        s += f'<rect x="{rx}" y="{fb3-88}" width="40" height="88" rx="6" fill="#2a3150"/>'
        for j in range(4):
            yy=fb3-80+j*19
            s += f'<rect x="{rx+5}" y="{yy}" width="30" height="12" rx="2.5" fill="#3a4470"/><circle class="{"led" if (i+j)%2 else "led2"}" cx="{rx+11}" cy="{yy+6}" r="2.2" fill="{"#35e0a1" if (i+j)%3 else "#8b5cf6"}"/>'
    # 2F desk + monitor
    s += f'<rect x="150" y="{fb2-34}" width="130" height="8" rx="3" fill="#d8b98a"/><rect x="160" y="{fb2-26}" width="6" height="26" fill="#b99a6b"/><rect x="264" y="{fb2-26}" width="6" height="26" fill="#b99a6b"/>'
    s += f'<rect x="190" y="{fb2-64}" width="40" height="28" rx="4" fill="#26304d"/><rect x="193" y="{fb2-61}" width="34" height="20" rx="2" fill="#7fe0c8" opacity=".85"/>'
    # 2F meeting table
    s += f'<rect x="470" y="{fb2-32}" width="150" height="10" rx="4" fill="#c99a5b"/><rect x="482" y="{fb2-22}" width="8" height="22" fill="#a9803f"/><rect x="600" y="{fb2-22}" width="8" height="22" fill="#a9803f"/>'
    # 1F sofa, plant, board
    s += f'<rect x="110" y="{fb1-30}" width="160" height="30" rx="12" fill="#3d9b7d"/><rect x="118" y="{fb1-52}" width="144" height="30" rx="12" fill="#2f8268"/>'
    s += f'<circle cx="330" cy="{fb1-18}" r="16" fill="#3d9b7d"/><circle cx="320" cy="{fb1-28}" r="9" fill="#4fb08f"/><rect x="322" y="{fb1-12}" width="16" height="12" rx="3" fill="#a9733f"/>'
    s += f'<rect x="510" y="{fb1-70}" width="130" height="46" rx="6" fill="#d8e0ee"/><text x="575" y="{fb1-42}" font-size="13" font-weight="700" fill="#4a5775" text-anchor="middle">오늘의 작업 현황</text>'
    # characters
    s += avatar(270,fb2-8,*P1[:2],P1[2])
    s += bubble(270,fb2-8-64-4,'코드 쓰는 중','write')
    s += avatar(600,fb3-8,*P2[:2],P2[2],'bob2')
    s += bubble(600,fb3-8-64-4,'테스트 실행 중','run')
    s += avatar(570,fb2-8,*P3[:2],P3[2],'bob3')
    s += bubble(570,fb2-8-64-4,'승인 기다리는 중','wait')
    s += '</svg>'
    return s

# ---------------- C: isometric ----------------
OX, OY = 400, 118
def P(x,y,z=0): return (OX+(x-y)*32, OY+(x+y)*16 - z)
def poly(pts, fill, stroke='none', op=1, extra=''):
    return f'<polygon points="{" ".join(f"{a:.1f},{b:.1f}" for a,b in pts)}" fill="{fill}" stroke="{stroke}" opacity="{op}" {extra}/>'
def box(x,y,z,w,d,h,top,left,right, extra=''):
    t=[P(x,y,z+h),P(x+w,y,z+h),P(x+w,y+d,z+h),P(x,y+d,z+h)]
    l=[P(x,y+d,z+h),P(x+w,y+d,z+h),P(x+w,y+d,z),P(x,y+d,z)]
    r=[P(x+w,y,z+h),P(x+w,y+d,z+h),P(x+w,y+d,z),P(x+w,y,z)]
    return poly(l,left,extra=extra)+poly(r,right,extra=extra)+poly(t,top,extra=extra)

def scene_c():
    s = '<svg viewBox="0 0 800 470" width="100%" role="img" aria-label="3D 아이소메트릭 사무실">'
    s += DEFS
    s += '<rect width="800" height="470" rx="18" fill="#dfe6f2"/>'
    s += '<ellipse cx="400" cy="300" rx="380" ry="170" fill="#e9eef7"/>'
    N=10
    # slab thickness
    slab_l=[P(0,N),P(N,N),(P(N,N)[0],P(N,N)[1]+14),(P(0,N)[0],P(0,N)[1]+14)]
    slab_r=[P(N,0),P(N,N),(P(N,N)[0],P(N,N)[1]+14),(P(N,0)[0],P(N,0)[1]+14)]
    s += poly(slab_l,'#8d99b3')+poly(slab_r,'#76829f')
    # floor
    s += poly([P(0,0),P(N,0),P(N,N),P(0,N)],'#f1f4f9')
    # zone tints
    def zone(x,y,w,d,c): return poly([P(x,y),P(x+w,y),P(x+w,y+d),P(x,y+d)],c)
    s += zone(0,0,4,3.6,'#dde8f8')       # 자료실
    s += zone(0,3.6,2.8,6.4,'#e5e0f6')    # 서버실 (left strip)
    s += zone(4,0,6,3.6,'#dcefe8')        # 작업실
    s += zone(5.4,5.4,4.6,4.6,'#f6ebd5')   # 회의실
    s += zone(2.8,6.8,2.4,3.2,'#e1f0e4')   # 휴게실
    # grid lines
    for i in range(N+1):
        a,b=P(i,0),P(i,N); s += f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#1d2540" stroke-opacity=".06"/>'
        a,b=P(0,i),P(N,i); s += f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#1d2540" stroke-opacity=".06"/>'
    # back walls
    H=86
    wl=[P(0,0),P(0,N),P(0,N,H),P(0,0,H)]
    wr=[P(0,0),P(N,0),P(N,0,H),P(0,0,H)]
    s += poly(wl,'#c7d1e4')+poly(wr,'#d6deed')
    s += poly([P(0,0,H),P(N,0,H),(P(N,0,H)[0],P(N,0,H)[1]-6),(P(0,0,H)[0],P(0,0,H)[1]-6)],'#aab6cf') if False else ''
    # windows on right-back wall (y=0)
    def win_r(x0,x1):
        pts=[P(x0,0,28),P(x1,0,28),P(x1,0,70),P(x0,0,70)]
        return poly(pts,'#cfe5fb','#fff',1,'stroke-width="3"')
    for a,b in ((4.6,6.4),(7.0,8.8)): s += win_r(a,b)
    def win_l(y0,y1):
        pts=[P(0,y0,28),P(0,y1,28),P(0,y1,70),P(0,y0,70)]
        return poly(pts,'#bcd5f1','#fff',1,'stroke-width="3"')
    s += win_l(4.4,6.4) + win_l(7.2,9.0)
    # bookshelf (자료실) along y=0
    s += box(0.6,0.15,0,3.0,0.8,70,'#c08a52','#a9733f','#8a5a2d')
    cols=['#4c8dff','#f26b6b','#f5a524','#13a58a','#8b5cf6','#e8637a']
    for k in range(8):
        x=0.8+k*0.34
        a,b=P(x,0.96,38+ (k%3)*4),P(x,0.96,6)
        s += f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{cols[k%6]}" stroke-width="7" stroke-linecap="round"/>'
        a,b=P(x,0.96,62-(k%2)*3),P(x,0.96,44)
        s += f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{cols[(k+2)%6]}" stroke-width="7" stroke-linecap="round"/>'
    # server racks along x=0
    racks=[]
    for k in range(3):
        y=4.0+k*1.9
        racks.append(box(0.15,y,0,1.0,1.5,66,'#3b4670','#2a3150','#252c48'))
        for j in range(5):
            z=10+j*11
            a=P(1.15,y+0.25,z+4); b=P(1.15,y+1.25,z+4)
            racks.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#46528a" stroke-width="7" stroke-linecap="round"/>')
            c=P(1.15,y+0.42,z+4)
            racks.append(f'<circle class="{"led" if (k+j)%2 else "led2"}" cx="{c[0]:.1f}" cy="{c[1]:.1f}" r="2.2" fill="{"#35e0a1" if (k+j)%3 else "#8b5cf6"}"/>')
    s += ''.join(racks)
    # desks (작업실)
    for (dx,dy) in ((4.6,1.4),(6.8,1.4)):
        s += box(dx,dy,0,1.7,0.9,22,'#e1c597','#bd9a69','#a9855a')
        s += box(dx+0.55,dy+0.12,22,0.6,0.12,20,'#33406a','#26304d','#26304d')
        mx=P(dx+0.6,dy+0.26,34)
        s += poly([P(dx+0.55,dy+0.24,24),P(dx+1.15,dy+0.24,24),P(dx+1.15,dy+0.24,40),P(dx+0.55,dy+0.24,40)],'#7fe0c8','none',.85)
    # meeting table 회의실
    s += box(6.1,6.4,0,2.8,1.8,22,'#dbb27a','#b98e55','#a07a46')
    s += box(6.9,6.85,22,1.2,0.9,2,'#ffffff','#e5e9f2','#d6dcea')
    # sofa 휴게실
    s += box(2.9,8.6,0,1.9,1.1,16,'#4fb08f','#3d9b7d','#2f8268')
    s += box(2.9,9.4,16,1.9,0.3,18,'#4fb08f','#3d9b7d','#2f8268')
    # plant
    s += box(9.0,3.6,0,0.5,0.5,12,'#c08a52','#a9733f','#8a5a2d')
    pc=P(9.25,3.85,28); s += f'<circle cx="{pc[0]:.1f}" cy="{pc[1]:.1f}" r="15" fill="#4fb08f"/><circle cx="{pc[0]-8:.1f}" cy="{pc[1]+4:.1f}" r="9" fill="#3d9b7d"/>'
    # floor labels
    def lab(x,y,t,c):
        px,py=P(x,y); w=len(t)*12.5+22
        return f'<g><rect x="{px-w/2:.1f}" y="{py-11:.1f}" width="{w:.1f}" height="22" rx="11" fill="#fff" opacity=".94"/><text x="{px:.1f}" y="{py+4.5:.1f}" font-size="12" font-weight="700" fill="{c}" text-anchor="middle">{t}</text></g>'
    s += lab(2.0,3.0,'자료실','#2f63c7') + lab(1.6,8.6,'서버실','#6a3fd1') + lab(8.2,3.2,'작업실','#0e7a67') + lab(8.1,9.4,'회의실','#a36a0a') + lab(4.0,9.4,'휴게실','#3d7a52')
    # characters (feet positions)
    def at(x,y,*a,**k):
        fx,fy=P(x,y); return avatar(fx,fy,*a,**k)
    p1=P(5.2,2.0); s += avatar(p1[0],p1[1],*P1[:2],P1[2],scale=.95)
    s += bubble(p1[0],p1[1]-84,'코드 쓰는 중','write')
    p2=P(1.6,4.8); s += avatar(p2[0],p2[1],*P2[:2],P2[2],'bob2',.95)
    s += bubble(p2[0],p2[1]-84,'테스트 실행 중','run')
    p3=P(8.2,8.2); s += avatar(p3[0],p3[1],*P3[:2],P3[2],'bob3',.95)
    s += bubble(p3[0],p3[1]-84,'승인 기다리는 중','wait')
    s += '</svg>'
    return s

def card(choice, title, desc, svg, note):
    return f'''<div class="card" data-choice="{choice}" onclick="toggleSelect(this)" style="margin-bottom:1.25rem">
  <div style="background:#e9eef6;padding:10px">{svg}</div>
  <div class="card-body"><h3>{title}</h3><p>{desc}</p><p style="margin-top:.35rem"><b>실제 구현:</b> {note}</p></div></div>'''

legend = ''.join(f'<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px"><i style="width:10px;height:10px;border-radius:50%;background:{c};display:inline-block"></i>{t}</span>' for t,c in (('파일 읽는 중',STATE['read']),('코드 쓰는 중',STATE['write']),('명령 실행 중',STATE['run']),('승인 기다리는 중',STATE['wait']),('쉬는 중',STATE['rest'])))

html = f'''<h2>어떤 회사 모습이 마음에 드세요?</h2>
<p class="subtitle">프로젝트 3개를 예시로 넣었어요. 아바타 위 말풍선이 지금 하는 일이고, 색깔은 상태를 뜻해요.</p>
<p style="margin:.25rem 0 1rem;font-size:.9rem">{legend}</p>
{card("topdown","A. 위에서 본 2D 사무실","방이 한 화면에 다 보이고, 아바타가 방 사이를 걸어 다녀요. 가장 가볍고 빨리 만들 수 있어요.",scene_a(),"도트·일러스트 2D, 브라우저 화면 하나로 동작")}
{card("cutaway","B. 옆에서 본 단면 건물","층마다 방이 있고 계단으로 오르내려요. 프로젝트가 많아져도 층만 늘리면 돼요.",scene_b(),"2D 단면, 층·방 추가가 쉬움")}
{card("iso3d","C. 3D 아이소메트릭 사무실","입체 가구와 3D 캐릭터, 카메라를 돌리고 확대할 수 있어요. 가장 화려하지만 품이 가장 많이 들어요.",scene_c(),"Three.js 3D 모델, 캐릭터 애니메이션 직접 제작")}
<p class="subtitle" style="margin-top:12px">마음에 드는 카드를 눌러 선택해 주세요. 섞고 싶은 부분이 있으면 말로 알려 주세요.</p>
'''
open(out,'w').write(html)
