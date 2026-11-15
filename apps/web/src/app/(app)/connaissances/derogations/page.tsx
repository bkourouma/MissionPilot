import type { Metadata } from "next";
import { BoutonProposition } from "../../../../components/connaissances/FormulairesConnaissances";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import {
  cheminAnalyseDerogations,
  lireSeuilDerogations,
  libelleNature,
  SEUIL_DEROGATIONS_MAX,
  SEUIL_DEROGATIONS_MIN,
  type GroupeDerogationsVue,
} from "../../../../lib/capitalisation";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Évolutions du standard", "Standard changes") };
}

/**
 * Analyse des dérogations (CAP-05), pour le comité méthode : groupes par brique et motif ; un
 * groupe fréquent devient une proposition d'évolution du standard, relue par un autre expert.
 * Les motifs ne sont lus que pour les missions que l'on voit ; les effectifs portent sur tout
 * le cabinet.
 */
export default async function PageDerogations({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("standard.gerer");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const brut = (await searchParams).seuil;
  const saisie = lireSeuilDerogations(brut, langue);
  // Seuil hors bornes : message lisible, analyse au seuil par défaut (jamais un 400 de l'API).
  const seuilDemande = saisie.ok ? saisie.charge.seuil : null;
  const r = await chargerServeur<{
    seuil: number;
    tronque: boolean;
    elements: GroupeDerogationsVue[];
  }>(cheminAnalyseDerogations(seuilDemande));
  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre={t("Évolutions du standard", "Standard changes")}
        soustitre={t(
          "Les dérogations qui se répètent signalent une méthode à faire évoluer : proposez-les au comité méthode.",
          "Waivers that keep recurring signal a method that needs to evolve: propose them to the method committee.",
        )}
      />
      <form
        method="get"
        className="mp-formulaire"
        aria-label={t("Seuil d'analyse", "Analysis threshold")}
      >
        <Champ
          libelle={t("Seuil (nombre de missions)", "Threshold (number of engagements)")}
          aide={t(
            `Un groupe devient « fréquent » à partir de ce nombre de missions concernées, de ${SEUIL_DEROGATIONS_MIN} à ${SEUIL_DEROGATIONS_MAX}. Laissez vide pour le seuil par défaut${r.ok ? ` (actuellement ${r.donnees.seuil})` : ""}.`,
            `A group becomes "frequent" from this number of engagements concerned, from ${SEUIL_DEROGATIONS_MIN} to ${SEUIL_DEROGATIONS_MAX}. Leave empty for the default threshold${r.ok ? ` (currently ${r.donnees.seuil})` : ""}.`,
          )}
          name="seuil"
          type="number"
          inputMode="numeric"
          min={SEUIL_DEROGATIONS_MIN}
          max={SEUIL_DEROGATIONS_MAX}
          step={1}
          defaultValue={typeof brut === "string" ? brut : ""}
          erreur={saisie.ok ? undefined : saisie.erreurs.seuil}
        />
        <div className="mp-actions-formulaire">
          <Bouton type="submit" variante="secondaire">
            {t("Analyser", "Analyze")}
          </Bouton>
        </div>
      </form>
      {!r.ok ? (
        <EtatErreur
          titre={t("L'analyse n'a pas pu être chargée.", "The analysis could not be loaded.")}
          message={r.message}
          hrefReessayer="/connaissances/derogations"
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={t("Aucune dérogation enregistrée.", "No waiver recorded.")} />
      ) : (
        <ul className="mp-connaissances__resultats">
          {r.donnees.elements.map((g) => (
            <li key={g.cle}>
              <Carte
                titre={t(
                  `${libelleNature(g.nature)} de la brique « ${g.brique_code} »`,
                  `${libelleNature(g.nature, "en")} of building block "${g.brique_code}"`,
                )}
                niveauTitre={2}
                actions={
                  g.au_dessus_du_seuil ? (
                    <BadgeStatut tonalite="attention">{t("Fréquente", "Frequent")}</BadgeStatut>
                  ) : (
                    <BadgeStatut tonalite="neutre">
                      {t("Sous le seuil", "Below threshold")}
                    </BadgeStatut>
                  )
                }
              >
                <p>
                  {t(
                    `${g.missions} missions · ${g.derogations} dérogations (${g.approuvees} approuvées, ${g.refusees} refusées, ${g.demandees} en attente)`,
                    `${g.missions} engagements · ${g.derogations} waivers (${g.approuvees} approved, ${g.refusees} refused, ${g.demandees} pending)`,
                  )}
                  {g.methode_code
                    ? t(` · méthode ${g.methode_code}`, ` · method ${g.methode_code}`)
                    : ""}
                </p>
                {g.mots_cles.length > 0 ? (
                  <p className="mp-texte-petit mp-texte-doux">
                    {t("Mots-clés :", "Keywords:")}{" "}
                    {g.mots_cles.map((m) => `${m.mot} (${m.occurrences})`).join(", ")}
                  </p>
                ) : null}
                {g.motifs.length > 0 ? (
                  <ul>
                    {g.motifs.slice(0, 5).map((m) => (
                      <li key={m.representant} className="mp-texte-petit">
                        {m.representant}{" "}
                        {m.effectif > 1
                          ? t(`(${m.effectif} motifs proches)`, `(${m.effectif} similar reasons)`)
                          : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mp-texte-petit mp-texte-doux">
                    {t(
                      "Motifs non visibles dans vos droits.",
                      "Reasons not visible within your permissions.",
                    )}
                  </p>
                )}
                {g.proposition ? (
                  <p className="mp-texte-petit">
                    {t("Proposition soumise :", "Proposal submitted:")} {g.proposition.titre} (
                    {g.proposition.statut}).
                  </p>
                ) : g.au_dessus_du_seuil ? (
                  <BoutonProposition cle={g.cle} seuil={r.donnees.seuil} />
                ) : null}
              </Carte>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
