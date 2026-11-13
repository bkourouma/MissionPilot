import type { Metadata } from "next";
import { BadgeNiveauEs } from "../../../../../../../components/due-diligence/BadgesDd";
import { DecisionExclusion } from "../../../../../../../components/due-diligence/DecisionExclusion";
import { FormulaireFiltrage } from "../../../../../../../components/due-diligence/FormulaireFiltrage";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  cheminFiltrages,
  droitsDd,
  hrefEcranDossier,
  libelleTheme,
  libellesDd,
  peutValiderSansConflit,
  phraseExclusionsAnterieures,
  type ReponseFiltrages,
} from "../../../../../../../lib/due-diligence";
import {
  chargerDossier,
  chargerListesExclusion,
  chargerTaxonomies,
} from "../../../../../../../lib/due-diligence-serveur";
import { formaterDateHeure } from "../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Environnement et social", "Environmental and social") };
}

/**
 * Filtrage environnemental et social (DD-14) : règles d'exclusion touchées par les activités
 * déclarées, décisions motivées d'un valideur (exclusion confirmée ou faux positif écarté) et
 * synthèse des huit thèmes. La dernière revue fait foi ; la synthèse est recalculée à chaque lecture.
 */
export default async function PageEnvironnementSocialDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const L = libellesDd(langue);
  const { utilisateur } = await exigerPermission("dd.lire");
  const [mission, dossier] = await Promise.all([chargerMission(id), chargerDossier(dossierId)]);
  if (!mission.ok || !dossier.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const r = await chargerServeur<ReponseFiltrages>(cheminFiltrages(dossierId));
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t(
          "La revue environnementale et sociale n'a pas pu être chargée.",
          "The environmental and social review could not be loaded.",
        )}
        message={r.message}
        hrefReessayer={hrefEcranDossier(id, dossierId, "environnement-social")}
      />
    );
  }
  const [listes, taxonomies] = droits.ecrire
    ? await Promise.all([chargerListesExclusion(), chargerTaxonomies()])
    : [null, null];
  const dernier = [...r.donnees.elements].sort((a, b) => b.numero - a.numero)[0] ?? null;
  const s = r.donnees.synthese;
  const anterieures = r.donnees.exclusions_anterieures_non_levees;
  const phraseAnterieures = phraseExclusionsAnterieures(anterieures.length, langue);
  const nomsThemes = (codes: string[]) => codes.map((c) => libelleTheme(c, langue)).join(", ");

  return (
    <>
      <p className="mp-texte-doux">
        {t(
          "Référence : normes de performance de la SFI (cadre public) ; les libellés sont ceux de CabinetPilot et restent à valider par un expert E&S.",
          "Reference: IFC performance standards (public framework); the labels are CabinetPilot's and remain to be validated by an E&S expert.",
        )}
      </p>

      {dernier === null || s === null ? (
        <p className="mp-texte-doux" role="status">
          {t(
            "Aucune revue n'a encore été réalisée pour ce dossier.",
            "No review has yet been carried out for this file.",
          )}
        </p>
      ) : (
        <>
          <Carte
            titre={t("Synthèse de la dernière revue", "Summary of the latest review")}
            niveauTitre={3}
          >
            <div className="mp-dd-pile">
              <span className="mp-dd-meta">
                <BadgeNiveauEs niveau={s.niveau_global} />
                <BadgeStatut tonalite={s.bloquant ? "danger" : "succes"}>
                  {s.bloquant
                    ? t("Bloquant : exclusion non levée", "Blocking: exclusion not cleared")
                    : t("Aucune exclusion bloquante", "No blocking exclusion")}
                </BadgeStatut>
                <span className="mp-texte-doux mp-texte-petit">
                  {formaterDateHeure(dernier.cree_le, undefined, langue)}
                </span>
              </span>
              {!s.complet ? (
                <Alerte
                  tonalite="attention"
                  titre={t("Revue incomplète", "Incomplete review")}
                  annonce="aucune"
                >
                  <p>
                    {t(
                      `Thèmes non évalués : ${nomsThemes(s.manquants) || "aucun"}.`,
                      `Themes not assessed: ${nomsThemes(s.manquants) || "none"}.`,
                    )}
                  </p>
                </Alerte>
              ) : null}
              {s.a_documenter.length > 0 ? (
                <p className="mp-texte-petit">
                  {t(
                    `Thèmes à documenter (niveau élevé ou critique, source absente ou fragile) : ${nomsThemes(s.a_documenter)}.`,
                    `Themes to document (high or critical level, source missing or weak): ${nomsThemes(s.a_documenter)}.`,
                  )}
                </p>
              ) : null}
              <ul className="mp-dd-liste" aria-label={t("Niveau par thème", "Level by theme")}>
                {dernier.themes.map((th) => (
                  <li key={th.code} className="mp-dd-element">
                    <span className="mp-dd-meta">
                      <strong>{libelleTheme(th.code, langue)}</strong>
                      <BadgeNiveauEs niveau={th.niveau} />
                    </span>
                    {th.justification ? <p className="mp-dd-texte">{th.justification}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          </Carte>

          {phraseAnterieures !== null && dernier !== null ? (
            <Carte
              titre={t("Exclusions antérieures non levées", "Earlier exclusions not cleared")}
              niveauTitre={3}
            >
              <div className="mp-dd-pile">
                <Alerte
                  tonalite="danger"
                  titre={t("Exclusion toujours bloquante", "Exclusion still blocking")}
                  annonce="aucune"
                >
                  <p>{phraseAnterieures}</p>
                </Alerte>
                <p className="mp-texte-petit mp-texte-doux">
                  {t(
                    "Une nouvelle revue dont les activités ne touchent plus la règle ne la lève pas : un valideur autre que l'auteur de la dernière revue doit écarter la règle.",
                    "A new review whose activities no longer hit the rule does not clear it: an approver other than the author of the latest review must dismiss the rule.",
                  )}
                </p>
                <ul
                  className="mp-dd-liste"
                  aria-label={t(
                    "Exclusions antérieures non levées",
                    "Earlier exclusions not cleared",
                  )}
                >
                  {anterieures.map((a) => (
                    <li key={a.regle} className="mp-dd-element">
                      <p className="mp-dd-element__titre">{a.libelle}</p>
                      <BadgeStatut tonalite="danger">
                        {t(
                          "Confirmée lors d'une revue antérieure",
                          "Confirmed in an earlier review",
                        )}
                      </BadgeStatut>
                      {droits.valider &&
                      peutValiderSansConflit(utilisateur.roles, utilisateur.id, [
                        dernier.auteur_id,
                      ]) ? (
                        <DecisionExclusion
                          filtrageId={dernier.id}
                          regleCode={a.regle}
                          libelleRegle={a.libelle}
                        />
                      ) : droits.valider ? (
                        <p className="mp-texte-doux mp-texte-petit">
                          {t(
                            "Vous avez lancé la dernière revue : une autre personne doit décider.",
                            "You started the latest review: someone else must decide.",
                          )}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </Carte>
          ) : null}

          <Carte titre={t("Règles d'exclusion touchées", "Exclusion rules hit")} niveauTitre={3}>
            {dernier.touches.length === 0 ? (
              <p className="mp-texte-doux">
                {t(
                  `Aucune règle n'est touchée (${dernier.non_touchees} règle(s) vérifiée(s)).`,
                  `No rule is hit (${dernier.non_touchees} rule(s) checked).`,
                )}
              </p>
            ) : (
              <ul className="mp-dd-liste" aria-label={t("Règles touchées", "Rules hit")}>
                {dernier.touches.map((tc) => (
                  <li key={tc.regle} className="mp-dd-element">
                    <p className="mp-dd-element__titre">{tc.libelle}</p>
                    <p className="mp-texte-petit">
                      {`${t("Critères touchés", "Criteria hit")} : ${tc.criteres.map((c) => L.CRITERE[c]).join(", ")}`}
                      {tc.mots_trouves.length > 0
                        ? ` · ${t("mots trouvés", "words found")} : ${tc.mots_trouves.join(", ")}`
                        : ""}
                    </p>
                    <p className="mp-texte-petit mp-texte-doux">
                      {t(
                        "Un mot-clé correspond aussi à ses dérivés : un faux positif est possible, à trancher par un valideur.",
                        "A keyword also matches its derived forms: a false positive is possible, to be settled by an approver.",
                      )}
                    </p>
                    {tc.decision ? (
                      <BadgeStatut tonalite={tc.decision === "confirmee" ? "danger" : "succes"}>
                        {L.DECISION_EXCLUSION[tc.decision]}
                      </BadgeStatut>
                    ) : (
                      <BadgeStatut tonalite="attention">
                        {t("Sans décision : bloquant", "No decision: blocking")}
                      </BadgeStatut>
                    )}
                    {droits.valider &&
                    peutValiderSansConflit(utilisateur.roles, utilisateur.id, [
                      dernier.auteur_id,
                    ]) ? (
                      <DecisionExclusion
                        filtrageId={dernier.id}
                        regleCode={tc.regle}
                        libelleRegle={tc.libelle}
                      />
                    ) : droits.valider ? (
                      <p className="mp-texte-doux mp-texte-petit">
                        {t(
                          "Vous avez lancé cette revue : une autre personne doit décider.",
                          "You started this review: someone else must decide.",
                        )}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Carte>
        </>
      )}

      {droits.ecrire && listes && taxonomies ? (
        <Carte
          titre={dernier ? t("Nouvelle revue", "New review") : t("Première revue", "First review")}
          niveauTitre={3}
        >
          {taxonomies.erreur ? (
            <Alerte
              tonalite="attention"
              titre={t("Listes de choix incomplètes", "Incomplete choice lists")}
              annonce="aucune"
            >
              <p>{taxonomies.erreur}</p>
            </Alerte>
          ) : null}
          <FormulaireFiltrage
            dossierId={dossierId}
            listes={listes.ok ? listes.donnees : []}
            erreurListes={listes.ok ? null : listes.message}
            secteurs={taxonomies.secteurs}
            pays={taxonomies.pays}
            dernier={dernier}
            parDefaut={{
              secteur_code: dossier.donnees.secteur_code,
              pays_code: dossier.donnees.pays_code,
            }}
          />
        </Carte>
      ) : null}
    </>
  );
}
