import Link from "next/link";
import { formaterJours, formaterPourcentage } from "../../lib/format";
import { statutEcart, type ElementMission } from "../../lib/indicateurs";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Calcule } from "../ui/Calcule";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { Trajectoire } from "../ui/Trajectoire";
import "./missions-en-vol.css";

/** Plus forte dérive d'abord : c'est la mission à regarder en premier. */
function parDerive(a: ElementMission, b: ElementMission): number {
  return (
    (b.ecart_terminaison.relatif_jours ?? 0) - (a.ecart_terminaison.relatif_jours ?? 0) ||
    b.ecart_terminaison.jours - a.ecart_terminaison.jours
  );
}

/**
 * « Missions en vol » : chaque mission avec son chemin parcouru, son budget de jours et son
 * atterrissage estimé (chiffres du moteur, jamais recalculés ici). La marge n'apparaît que si
 * l'API la sert (FIN-02).
 */
export function MissionsEnVol({
  elements,
  limite = 8,
}: {
  elements: readonly ElementMission[];
  limite?: number;
}) {
  const lignes = [...elements].sort(parDerive).slice(0, limite);
  const avecMarge = lignes.some((m) => typeof m.marge?.taux_marge === "number");
  const colonnes: ColonneTableau<ElementMission>[] = [
    {
      cle: "mission",
      entete: "Mission",
      rendu: (m) => <Link href={`/missions/${m.mission_id}`}>{m.intitule}</Link>,
    },
    {
      cle: "jours",
      entete: "Réalisés / budgétés",
      alignement: "droite",
      rendu: (m) => `${formaterJours(m.jours_realises)} / ${formaterJours(m.jours_budget)}`,
    },
    {
      cle: "trajectoire",
      entete: "Trajectoire",
      rendu: (m) => (
        <Trajectoire
          budget={m.jours_budget}
          realises={m.jours_realises}
          atterrissage={m.jours_atterrissage}
        />
      ),
    },
    ...(avecMarge
      ? [
          {
            cle: "marge",
            entete: "Marge",
            alignement: "droite" as const,
            rendu: (m: ElementMission) =>
              typeof m.marge?.taux_marge === "number" ? (
                formaterPourcentage(m.marge.taux_marge)
              ) : (
                <span data-vide>—</span>
              ),
          },
        ]
      : []),
    {
      cle: "ecart",
      entete: "Écart de cap",
      rendu: (m) => {
        const s = statutEcart(m.ecart_terminaison.relatif_jours, m.ecart_terminaison.jours);
        return <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>;
      },
    },
  ];
  return (
    <section className="mp-missions-en-vol" aria-labelledby="titre-missions-en-vol">
      <div className="mp-missions-en-vol__entete">
        <h3 id="titre-missions-en-vol" className="mp-missions-en-vol__titre">
          Missions en vol
        </h3>
        <Calcule />
      </div>
      <Tableau
        legende="Missions en vol, classées par écart de cap"
        colonnes={colonnes}
        lignes={lignes}
        cleLigne={(m) => m.mission_id}
        messageVide="Aucune mission en cours sur la période."
      />
      {elements.length > lignes.length ? (
        <p className="mp-texte-doux">
          {`${lignes.length} missions sur ${elements.length}. `}
          <Link href="/indicateurs">Voir toutes les missions dans les indicateurs</Link>
        </p>
      ) : null}
    </section>
  );
}
