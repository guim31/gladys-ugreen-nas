# UGREEN NAS

Suivez depuis Gladys un NAS UGREEN NASync sous UGOS Pro : processeur,
mémoire, températures, réseau, volumes et disques, avec des scènes quand un
volume ou un disque demande attention, et un widget de tableau de bord.

L'intégration ne fait que **lire** : elle ne modifie jamais rien sur le NAS —
ni arrêt, ni redémarrage, ni opération sur les fichiers.

> **Développée sans le matériel : retours bienvenus.** L'API d'UGOS Pro n'est
> pas documentée ; cette intégration suit ce que d'autres projets libres lisent
> sur de vrais NAS. Si quelque chose manque ou est faux sur le vôtre, ouvrez
> une issue : <https://github.com/guim31/gladys-ugreen-nas/issues>.

Non affiliée à UGREEN, ni approuvée ni financée par UGREEN. UGREEN, NASync et
UGOS sont des marques de leurs propriétaires.

## Ce que vous obtenez

Une fois la configuration faite, l'onglet **Découverte** propose les appareils
suivants. Ajoutez ceux que vous voulez suivre : rien n'est créé à votre place.

### Le NAS

- **En ligne** : 1 tant que le NAS répond, 0 dès qu'il ne répond plus.
- **Processeur** et **Mémoire** : utilisation, en %.
- **Température du processeur**, en °C (si le firmware la donne).
- **Réception** et **Émission** : débits réseau du NAS, en Mbit/s.
- **Durée de fonctionnement**, en jours.
- **Version d'UGOS**.

### Volumes

Un appareil par volume (`Volume 1`, `Volume 2`…) :

- **Espace utilisé**, en % ;
- **Capacité** et **Espace libre**, en Go ;
- **État** : Sain, Avertissement, Reconstruction, Dégradé, Défaillant (le pire
  du volume et de son pool de stockage) ;
- **Alerte** : 1 quand l'état demande attention, 0 sinon — pratique dans les
  scènes et l'historique.

### Disques

Un appareil par disque (disques durs et M.2) :

- **Température**, en °C ;
- **État**, tel qu'UGOS juge le disque d'après ses contrôles de santé : Sain,
  Avertissement, Critique, En panne (aussi Non détecté, Verrouillé) ;
- **Alerte** : 1 pour Avertissement, Critique ou En panne.

L'intégration ne lance jamais de test SMART et ne lit jamais le détail SMART :
ces requêtes réveillent les disques en veille. L'état affiché est celui
qu'UGOS tient déjà.

## Avant de commencer

### Un compte dédié

Créez sur le NAS un compte pour Gladys (UGOS Pro → Panneau de configuration →
Utilisateurs). À notre connaissance, UGOS n'offre pas de rôle en lecture seule :
commencez par un utilisateur standard. Si les volumes et les disques n'apparaissent pas
(l'action **Tester la connexion** indique « stockage illisible avec ce
compte »), ajoutez ce compte au groupe des administrateurs. Son mot de passe
donne alors accès au NAS : réservez-le à Gladys.

### Double authentification

L'intégration ne peut pas saisir de code à usage unique : utilisez un compte
sans double authentification.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. **Adresse du NAS** : son adresse IP sur votre réseau, par exemple
   `192.168.1.50`. Le port de l'API, 9999, est ajouté. Une adresse complète
   fonctionne aussi : `http://192.168.1.50:9999`.
3. **Nom d'utilisateur** et **Mot de passe** du compte ci-dessus. Le mot de
   passe est envoyé chiffré avec la clé du NAS et n'est jamais écrit dans les
   logs.
4. **Fréquence de relevé** : toutes les minutes (par défaut), 2 ou 5 minutes.
5. **Langue des noms et des états** : Gladys ne transmet pas votre langue à
   une intégration. Les noms des fonctionnalités (figés à l'ajout d'un
   appareil), les états et les variables de scène utilisent celle-ci.
6. Enregistrez, puis ajoutez les appareils depuis l'onglet **Découverte**.

Pourquoi le HTTP simple sur le port 9999 : c'est là qu'UGOS Pro sert son API,
comme l'utilisent l'interface web et les autres projets. Le mot de passe ne
circule jamais en clair (chiffrement RSA, comme le fait l'interface web). En
HTTPS, le NAS présente un certificat auto-signé : une adresse `https://`
fonctionne aussi, le certificat est alors accepté sans vérification.

## Scènes

L'intégration ajoute trois déclencheurs à l'éditeur de scènes, dans la
catégorie **Intégrations** :

- **Volume dégradé** : un volume ou son pool de stockage demande attention
  (Avertissement, Reconstruction, Dégradé ou Défaillant). Redéclenché
  seulement s'il empire, et de nouveau après être redevenu sain. Choix du
  volume facultatif. Variables : NAS, Volume, État.
- **Disque en alerte** : UGOS juge un disque en Avertissement, Critique ou En
  panne. Mêmes règles. Choix du disque facultatif. Variables : NAS, Disque,
  Modèle, État, Température (°C).
- **NAS injoignable** : le NAS n'a pas répondu à deux relevés de suite, à
  15 secondes environ d'intervalle. Une fois, jusqu'à ce qu'il réponde de
  nouveau. Variables : NAS, Raison.

Les états vus sont conservés sous `/data` : un redémarrage de Gladys ou de
l'intégration ne répète ni ne manque une annonce. Le tout premier relevé ne
fait qu'enregistrer les états.

## Widget de tableau de bord

Le widget **NAS UGREEN** affiche les jauges du processeur et de la mémoire,
la température du processeur, puis les volumes et disques qui demandent
attention, chaque volume avec son taux d'utilisation et son espace libre, les
débits réseau et la durée de fonctionnement. Le bouton **Actualiser** relit
le NAS.

## Tester la connexion

L'action **Tester la connexion** de l'onglet Configuration lit le NAS tout de
suite et indique le modèle, la version d'UGOS et le nombre de volumes et de
disques trouvés — ou pourquoi cela a échoué.

## Limites

- Un seul NAS par installation.
- Testée uniquement sur des réponses reconstituées, pas sur un vrai NAS (voir
  plus haut).
- Aucune action sur le NAS. Un bouton « Redémarrer le NAS » a été écarté
  volontairement : il exigerait un compte administrateur, et une fausse
  manœuvre coûte trop cher.
- Après un mot de passe refusé, l'intégration cesse d'essayer d'elle-même
  (UGOS bloque une adresse après quelques échecs de connexion). Corrigez le
  mot de passe et enregistrez, ou utilisez **Tester la connexion** pour
  réessayer.

## Dépannage

- **« ne répond pas »** : vérifiez l'adresse, que le NAS est allumé, et que
  Gladys atteint le port 9999 (pare-feu, autre réseau).
- **« pas d'API UGOS Pro à cette adresse »** : l'adresse répond, mais pas
  comme UGOS Pro. Vérifiez le port (9999) ; l'ancien UGOS (non Pro) n'est pas
  pris en charge.
- **« nom d'utilisateur ou mot de passe refusé »** : vérifiez-les dans UGOS,
  puis enregistrez de nouveau la configuration.
- **Aucun volume, aucun disque** : voir « Un compte dédié » plus haut.
- **Une température manque** : certains firmwares n'en donnent pas, ou pas
  pendant qu'un disque est en veille.

## Retours

Modèles couverts : la gamme UGREEN NASync sous UGOS Pro (DXP2800, DXP4800,
DXP4800 Plus, DXP6800 Pro, DXP8800 Plus, DXP480T Plus…), en théorie : aucun
modèle n'a pu être testé. Un retour depuis votre NAS — ce qui marche, ce qui
manque — est la contribution la plus utile :
<https://github.com/guim31/gladys-ugreen-nas/issues>.
