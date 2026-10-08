# VOID Studio Link - TouchDesigner setup.
#
# Paste into a Text DAT inside the component you want to hold the link,
# then right-click the DAT > Run Script. It makes:
#   void_in   OSC In CHOP on port 9001 (VOID's state: void/state, void/blend, ...)
#   void_out  OSC Out CHOP to 127.0.0.1:9000 (channels named void/<slider> play VOID)
#
# Written from TouchDesigner's documentation, not run here: if a parameter
# name differs in your build, set the two ports by hand.

parent_comp = me.parent()

void_in = parent_comp.op('void_in') or parent_comp.create(oscinCHOP, 'void_in')
void_in.par.port = 9001
void_in.nodeX, void_in.nodeY = 0, 0

void_out = parent_comp.op('void_out') or parent_comp.create(oscoutCHOP, 'void_out')
void_out.par.netaddress = '127.0.0.1'
void_out.par.port = 9000
void_out.nodeX, void_out.nodeY = 0, -150

# Something to send: a constant named for a slider VOID can listen to.
# In VOID: Glow's listen dot > OSC > address /void/glow.
glow = parent_comp.op('void_glow') or parent_comp.create(constantCHOP, 'void_glow')
glow.par.name0 = 'void/glow'
glow.par.value0 = 0.5
glow.nodeX, glow.nodeY = -200, -150
void_out.inputConnectors[0].connect(glow)

print('VOID Studio Link: void_in on 9001, void_out to 127.0.0.1:9000')
