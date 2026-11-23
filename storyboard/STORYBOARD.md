# Storyboard and script

Generated from `storyboard/shots.ts` by `npm run storyboard`. Edit the shot list, not this file.


## Hook (from 0:00)

| Shot | At | Secs | Narration | On screen | Tag |
|---|---|---|---|---|---|
| H-01 | 0:00 | 14 | If you've ever parked behind a building in GTA, sure the cops had lost you, and watched them drive straight to you anyway, you weren't imagining it. | A two-star chase. The car breaks line of sight and parks. Police drive straight to it. | My sim |
| H-02 | 0:14 | 12 | When GTA 6 came out, Rockstar's VP of Technology said it plainly. In the older games, the cops were always able to pinpoint the player's exact location. | Quote card with name, title and outlet. | Rockstar |
| H-03 | 0:26 | 14 | So how do you build police that actually have to look for you? And how do you fill a whole city with traffic for them to chase you through? | The same chase against police who only know what they see. They head for the question mark, not the car. | My sim |
| H-04 | 0:40 | 9 | That same engineer's name is on a patent about how game traffic works. It's public. Anyone can read it. | Patent details as a text card. | Patent |
| H-05 | 0:49 | 13 | So I read it, rebuilt it as a little 2D city, added police, and ran six thousand chases to see what changes when the cops have to search. | Street level, then a fast pull back to the whole city. | My sim |
| H-06 | 1:02 | 16 | Quick honesty note. This is a patent, some things modders have dug out of the older games, and my own rebuild. It is not Rockstar's code, and I'll tell you which is which as we go. | The four source badges, appearing one by one. |  |

## Loop 1: the city is mostly empty (from 1:18)

| Shot | At | Secs | Narration | On screen | Tag |
|---|---|---|---|---|---|
| L1-01 | 1:18 | 13 | Start with the traffic. Here's one car driving through my city. Busy streets, cars at every junction. How many cars would you guess the city is simulating right now? | Follow one car through busy streets. | My sim |
| L1-02 | 1:31 | 14 | The honest way to do it is to simulate every car on every street, all the time. For a map this size that's well over a thousand cars nobody is looking at. | Same drive, continuing. | My sim |
| L1-03 | 1:45 | 12 | The patent has a section on how games usually cheat here, and one line will sound familiar. Cars that fade out of existence as the player approaches. | Short patent quote as a card. | Patent |
| L1-04 | 1:57 | 10 | So let's zoom out. | The reveal. The camera pulls back from the car to the whole city. Hold in silence. | My sim |
| L1-05 | 2:07 | 12 | That's all of it. A bubble of traffic about 380 meters across, in a city ten times that wide. Everything outside it is empty road. | Whole city. The bubble outline switches on, with a live count of cars. | My sim |
| L1-06 | 2:19 | 14 | Drive anywhere and the bubble comes with you. Cars get created just ahead of you and deleted just behind you. From the driver's seat, it looks like a full city. | Half zoom, following the car, so you can see traffic appear at the front edge and vanish at the back. | My sim |
| L1-07 | 2:33 | 11 | So the game only has to get a few hundred cars right. Which raises the next question. What are those cars actually doing? | Push back in to street level. | My sim |

## Loop 2: most cars have nowhere to be (from 2:44)

| Shot | At | Secs | Narration | On screen | Tag |
|---|---|---|---|---|---|
| L2-01 | 2:44 | 13 | Strip the map down and a road is just dots joined by lines. A car sits on a dot and has one job, which is picking the next dot. | One block drawn as dots and lines, with one car. | My sim |
| L2-02 | 2:57 | 10 | The cheapest rule is to pick a random exit at every junction. No destination, no plan. The car just wanders. | Ten cars on the block, each taking random turns. | My sim |
| L2-03 | 3:07 | 12 | The patent calls this the conventional approach. And modders who documented GTA 5's driving functions found one that does exactly this. Drive around with no destination. | Two short lines, one from the patent, one from modder documentation. | Patent, Modders |
| L2-04 | 3:19 | 14 | It's cheap, and up close it looks fine. But look at the whole district. Traffic is spread evenly over every street. Real cities don't look like that. Real cities have main roads. | A whole district of wandering cars, evenly spread. | My sim |
| L2-05 | 3:33 | 15 | The upgrade is to give each car a destination and let it search for a route. The search spreads out from the start, one dot at a time, until it reaches the goal. | A route search flooding out from A until it reaches B, with a counter. | My sim |
| L2-06 | 3:48 | 14 | Give every car a route and the picture changes. Traffic drains off the side streets and piles onto the main roads and the highway. Same city, same number of cars. | Split screen. Left: wandering, evenly spread. Right: routed, piled onto main roads. | My sim |
| L2-07 | 4:02 | 15 | The problem is cost. This trip, corner to corner, checks about six thousand dots. A typical trip in this city is about two thousand. Now do that for every car, over and over. | One search flooding across the whole city, counter climbing. | My sim |

## Loop 3: the patent's main trick (from 4:17)

| Shot | At | Secs | Narration | On screen | Tag |
|---|---|---|---|---|---|
| L3-01 | 4:17 | 12 | So which of those dots actually matter? Most of them sit on a plain stretch of road where there's no decision to make. You just keep going. | The district as dots, zoomed in on a few blocks. | My sim |
| L3-02 | 4:29 | 12 | The only places a route can change are the forks. So the patent builds a second map with nothing but forks, and searches that instead. | Forks light up as plus signs. Pull back to see the whole fork map. | Patent |
| L3-03 | 4:41 | 10 | The patent's claim is that you get the same route while checking far fewer points. That's something I can test. | My city as two numbers: every point against forks only. | Patent, My sim |
| L3-04 | 4:51 | 14 | Same trip, both ways. The fine dots are the full search, about six thousand points. The big squares are the fork search, about seven hundred. And the route they find is identical. | Both searches on one trip across the city, with both counters. | My sim |
| L3-05 | 5:05 | 10 | Across 400 random trips, that came out to about eight and a half times less work. And every single route matched. | The headline number and the check. | My sim |
| L3-06 | 5:15 | 16 | Here's where I was wrong. I expected the saving to grow as the city got bigger. It doesn't. From a 36 intersection town to a 4,000 intersection city, it stays flat at about eight and a half. | Chart: the saving against city size. A flat line. | My sim |
| L3-07 | 5:31 | 18 | The saving depends on how many dots sit between forks, and that doesn't change with the size of the map. It's also not a new idea. Collapsing straight roads is standard in routing. The patent is one specific system built around it. | Close on one road: a run of plain dots between two forks. | My sim |
| L3-08 | 5:49 | 12 | So routes are cheap and the city is mostly empty. But filling that bubble has a bug in it, and the patent describes that too. | Back to the bubble, slowly pushing in toward the highway. | My sim |

## Loop 4: the overpass bug (from 6:01)

| Shot | At | Secs | Narration | On screen | Tag |
|---|---|---|---|---|---|
| L4-01 | 6:01 | 15 | How does the bubble decide where to put a new car? Every road has a target for how busy it should be. Before adding a car, the game counts the cars already nearby. | The bubble sitting over the elevated highway, no marks yet. | Patent |
| L4-02 | 6:16 | 18 | The obvious way to count nearby is a straight line distance. The patent shows why that breaks. A car up on a highway overpass gets counted as if it were on the street underneath, even though the two roads never connect. | My diagram of the patent example: a highway car lands inside the street's counting circle. | Patent |
| L4-03 | 6:34 | 15 | So I built the straight line version on purpose, to see if the bug is real. Every red mark is a spot where the game decided the road was full when it wasn't. | Red marks building up, sped up, with a count. | My sim |
| L4-04 | 6:49 | 11 | They hug the highway. More than half of them land within 90 meters of it, and the streets alongside end up noticeably thinner. | Same shot, pushing in on the marks along the highway. | My sim |
| L4-05 | 7:00 | 12 | The patent's fix is to measure along the road and only count cars you could actually drive to. Same city, same seed. The red marks are gone. | Counting along the road. No red marks appear. | Patent, My sim |
| L4-06 | 7:12 | 6 | Now the city holds up. Time to commit a crime in it. | Street level, following the car through traffic. | My sim |

## Loop 5: how the police find you (from 7:18)

| Shot | At | Secs | Narration | On screen | Tag |
|---|---|---|---|---|---|
| L5-01 | 7:18 | 12 | One star, one patrol car. This is roughly what GTA 5 shows you on the minimap. Every officer has a cone of vision, and buildings block it. | A one-star chase. The patrol car and its vision cone, clipped by buildings. | Modders |
| L5-02 | 7:30 | 14 | Get out of every cone and they don't just give up. They drive to the last place they saw you and search outward from there. Stay hidden long enough and you're clear. | The car breaks line of sight. A question mark marks where police last saw it. The timer runs out. | My sim |
| L5-03 | 7:44 | 17 | It takes longer the more stars you have. In my version it's ten seconds at one star and forty at five. Those numbers are mine. The patent barely mentions chases, so the police rules here are my own design. | My wanted-level rules as a small table. | My sim |
| L5-04 | 8:01 | 15 | Here's a two star chase where the police only know what they can see. Watch the question mark. That's where they think I am. They're heading there, and I'm not. | Police converge on the question mark while the car sits parked nearby. | My sim |
| L5-05 | 8:16 | 15 | Now the same chase with the kind of police Rockstar described. Psychic police. No question mark, no search. Every unit knows exactly where I parked. | Same start, same car. Police drive straight to it. | Rockstar, My sim |
| L5-06 | 8:31 | 10 | At four stars a helicopter joins in. It sees over buildings, but not under the highway. | Five stars: units, a roadblock, and the helicopter circling. | My sim |
| L5-07 | 8:41 | 17 | I came up with five ways to run. Head for the highway. Floor it in a straight line. Break line of sight and keep moving. Turn at every junction. Or break line of sight and hide. Pick one now. | The five plans, listed one by one. Hold on the full list. | My sim |

## Loop 6: the experiment (from 8:58)

| Shot | At | Secs | Narration | On screen | Tag |
|---|---|---|---|---|---|
| L6-01 | 8:58 | 17 | Then I ran all five, against three police tactics, at every star level. Once against psychic police and once against police who have to search. Six thousand chases, same starting points for both. | A five-star chase at double speed, ending in a capture. | My sim |
| L6-02 | 9:15 | 9 | Psychic police first. One star is easy. By five stars you get away about two percent of the time. | Chart: escape rate by stars. The psychic line draws in. | My sim |
| L6-03 | 9:24 | 9 | Make them search and five stars goes from two percent to about sixteen. Still brutal, but now it's possible. | Same chart. The searching line draws in above it. | My sim |
| L6-04 | 9:33 | 12 | The bigger change is hiding. At two stars, hiding from psychic police works eight percent of the time. Against police who have to search, about sixty. | Chart: hiding only. Psychic line first, then the searching line. | My sim |
| L6-05 | 9:45 | 14 | That's a whole way of playing that only exists because of one design decision. If the police always know where you are, there's no such thing as hiding. | The parked car waits while police search the wrong spot. The timer runs out: escaped. | My sim |
| L6-06 | 9:59 | 18 | Here's the twist though. Even with police who search, hiding is the worst plan from two stars up. At four and five stars it never worked once. The best plan at every level was the highway. Forty one percent at five stars. | Chart: all five plans against searching police. Hiding draws in last, underneath everything. | My sim |
| L6-07 | 10:17 | 15 | The reason is how they search. They sweep outward from the last place they saw you, so a car parked near that spot gets found before the timer runs out. Distance beats cover. | Three stars. The car parks, the search ring spreads out from the question mark, and a unit finds it. | My sim |
| L6-08 | 10:32 | 14 | My car is slightly faster than the police, so I checked that wasn't the whole story. I reran it with police slower than me and faster than me. The ranking didn't flip. | Chart: escape rate against police speed. Highway lines stay above hiding lines all the way across. | My sim |
| L6-09 | 10:46 | 10 | One big caveat. These are rules and numbers I picked. This is a result about my simulation, not about GTA. | The caveat as plain text. | My sim |

## Close (from 10:56)

| Shot | At | Secs | Narration | On screen | Tag |
|---|---|---|---|---|---|
| C-01 | 10:56 | 15 | So that's what I found. Traffic is mostly cars with nowhere to be, living in a bubble that follows you around. And police that have to search are what make hiding possible at all. | The bubble drifting through the empty city. | My sim |
| C-02 | 11:11 | 12 | Everything here came from a public patent, what modders have documented, and my own rebuild. Rockstar has never said this patent is in any GTA game. | The three sources, and the caveat. |  |
| C-03 | 11:23 | 26 | The whole thing runs in your browser and the code is open. Links and every source are in the description. See if you can beat forty one percent. | A five-star highway run that gets away. End screen goes over this. | My sim |

Total: 53 shots, 11:49 of footage, 1485 words of narration.
