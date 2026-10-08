import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { UNITE_LIBELLES } from "../../../../lib/cabinet";
import { formaterNombre } from "../../../../lib/format";
import { exigerPermission } from "../../../../lib/session";
import type { ParametresTemps } from "../../../../lib/temps-admin";
import type { ActiviteInterne } from "../../../../lib/temps";
import { AjoutActivite, BasculeActivite, FormulaireParametresTemps } from "./ParametresTemps";

export const metadata: Metadata = { title: "Paramètres des temps" };

export default async function PageParametresTemps() {
  await exigerPermission("cabinet.gerer");
  const [p, activites] = await Promise.all([
    chargerServeur<ParametresTemps>("/api/temps/parametres"),
    chargerServeur<{ elements: ActiviteInterne[] }>(
      "/api/activites-internes?inclure_inactives=true",
    ),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Temps"
        soustitre="Unité de saisie, contrôle de la capacité journalière, seuil d'alerte et activités internes non facturables."
      />
      <Carte titre="Saisie et alertes">
        {!p.ok ? (
          <EtatErreur
            titre="Les paramètres n'ont pas pu être chargés."
            message={p.message}
            hrefReessayer="/parametres/temps"
          />
        ) : (
          <div className="mp-pile">
            <p>
              {`Unité de saisie : ${UNITE_LIBELLES[p.donnees.unite_saisie_temps]}`}
              {p.donnees.unite_saisie_temps === "heure"
                ? ` (journée de ${formaterNombre(p.donnees.heures_par_jour)} h)`
                : " (pas de 0,5 jour)"}
              {". "}
              <span className="mp-texte-doux">
                Elle se change dans <Link href="/parametres">les informations du cabinet</Link>.
              </span>
            </p>
            <FormulaireParametresTemps parametres={p.donnees} />
          </div>
        )}
      </Carte>

      <Carte titre="Activités internes">
        <div className="mp-pile">
          {!activites.ok ? (
            <EtatErreur
              titre="Les activités n'ont pas pu être chargées."
              message={activites.message}
              hrefReessayer="/parametres/temps"
            />
          ) : activites.donnees.elements.length === 0 ? (
            <EtatVide titre="Aucune activité interne." icone="horloge">
              <p>Formation, prospection, administration, congés : ajoutez-les ci-dessous.</p>
            </EtatVide>
          ) : (
            <ul className="mp-liste-lignes" aria-label="Activités internes">
              {activites.donnees.elements.map((a) => (
                <li key={a.id} className="mp-liste-lignes__ligne">
                  <span className="mp-liste-lignes__texte">
                    <strong>{a.libelle}</strong>
                    <span className="mp-texte-doux">{`${a.code}${a.est_absence ? " · absence" : ""}`}</span>
                  </span>
                  {a.actif === false ? (
                    <BadgeStatut tonalite="neutre">Désactivée</BadgeStatut>
                  ) : null}
                  <BasculeActivite activite={a} />
                </li>
              ))}
            </ul>
          )}
          <AjoutActivite />
        </div>
      </Carte>
    </div>
  );
}
