"""Random room name picker using the JoJo / music Stand name catalog."""
import random

ROOM_NAMES: list[str] = [
    "20th Century Boy", "Achtung Baby", "Aerosmith", "Anubis", "Aqua Necklace",
    "Atom Heart Father", "Atum", "Awaking 3 Leaves", "Awaking III Leaves",
    "Baby Face", "Bad Company", "Bags Groove", "Ball Breaker", "Bastet",
    "Beach Boy", "Bites the Dust", "Black Sabbath", "Blue Hawaii",
    "Bohemian Rhapsody", "Boku no Rhythm wo Kiitekure", "Born This Way",
    "Boy II Man", "Brain Storm", "Burning Down the House", "C-MOON",
    "California King Bed", "Cat Size", "Catch the Rainbow", "Chariot Requiem",
    "Cheap Trick", "Chocolate Disco", "Cinderella", "Civil War", "Clash",
    "Crazy Diamond", "Cream", "Cream Starter", "D4C Love Train", "Dark Blue Moon",
    "Death Thirteen", "Dirty Deeds Done Dirt Cheap", "Diver Down", "Doctor Wu",
    "Doggy Style", "Doobie Wah!", "Dragon's Dream", "Earth Wind and Fire",
    "Ebony Devil", "Echoes", "Emperor", "Empress", "Enigma", "Foo Fighters",
    "Fun Fun Fun", "Geb", "Glory Days", "Gold Experience", "Gold Experience Requiem",
    "Goo Goo Dolls", "Green Day", "Green, Green Grass of Home", "Hanged Man",
    "Harvest", "Heaven's Door", "Hermit Purple", "Hierophant Green",
    "High Priestess", "Highway Star", "Highway to Hell", "Horus", "I Am a Rock",
    "In a Silent Way", "Jail House Lock", "Judgement", "Jumpin' Jack Flash",
    "Justice", "Khnum", "Killer Queen", "King Crimson", "King Nothing", "Kiss",
    "Kraft Work", "Les Feuilles", "Limp Bizkit", "Little Feet", "Love Deluxe",
    "Lovers", "Made in Heaven", "Magician's Red", "Man in the Mirror", "Mandom",
    "Manhattan Transfer", "Marilyn Manson", "Matte Kudasai", "Metallica",
    "Milagro Man", "Moody Blues", "Mr. President", "Notorious B.I.G",
    "November Rain", "Nut King Call", "Oasis", "Oh! Lonesome Me", "Osiris",
    "Ozon Baby", "Ozone Baby", "Paisley Park", "Paper Moon King", "Pearl Jam",
    "Planet Waves", "Ptah", "Purple Haze", "Ratt", "Red Hot Chili Pepper",
    "Rolling Stones", "Scary Monsters", "Schott Key No.1", "Schott Key No.2",
    "Sethan", "Sex Pistols", "Sheer Heart Attack", "Silver Chariot", "Sky High",
    "Smooth Operators", "Soft & Wet", "Soft Machine", "Space Trucking",
    "Speed King", "Spice Girl", "Star Platinum", "Sticky Fingers", "Stone Free",
    "Stray Cat", "Strength", "Sugar Mountain's Spring", "Sun", "Super Fly",
    "Surface", "Survivor", "Talking Head", "Tattoo You!", "Tenore Sax",
    "The Fool", "The Grateful Dead", "The Hand", "The Hustle", "The Lock",
    "The World", "Ticket to Ride", "Tohth", "Tomb of the Boom", "Tower of Gray",
    "Tubular Bells", "Tusk", "Under World", "Vitamin C", "Walking Heart",
    "Weather Report", "Wheel of Fortune", "White Album", "Whitesnake", "Wired",
    "Wonder of U", "Yellow Temperance", "Yo-Yo Ma",
]

_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]


def pick_room_name(existing_names: set[str]) -> str:
    available = [n for n in ROOM_NAMES if n not in existing_names]
    if available:
        return random.choice(available)
    # All base names taken — try suffixed variants
    for base in random.sample(ROOM_NAMES, len(ROOM_NAMES)):
        for roman in _ROMAN:
            candidate = f"{base} {roman}"
            if candidate not in existing_names:
                return candidate
    return f"Sala {random.randint(1000, 9999)}"
