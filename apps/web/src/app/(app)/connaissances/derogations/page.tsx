import type { Metadata } from "next";
import { BoutonProposition } from "../../../../components/connaissances/FormulairesConnaissances";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { libelleNature, type GroupeDerogationsVue } from "../../../../lib/capitalisation";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Évolutions du standard" };

/**
 * Analyse des dérogations (CAP-05), pour le comité méthode : groupes par brique et motif ; un
 * groupe fréquent devient une proposition d'évolution du standard, relue par un autre expert.
 * Les motifs ne sont lus que pour les missions que l'on voit ; les effectifs portent sur tout
 * le cabinet.
 */
export default async function PageDerogations() {
  await exigerPermission("standard.gerer");
  const r = await chargerServeur<{
    seuil: number;
    tronque: boolean;
    elements: GroupeDerogationsVue[];
  }>("/api/capitalisation/derogations/analyse");
  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre="Évolutions du standard"
        soustitre="Les dérogations qui se répètent signalent une méthode à faire évoluer : proposez-les au comité méthode."
      />
      {!r.ok ? (
        <EtatErreur
          titre="L'analyse n'a pas pu être chargée."
          message={r.message}
          hrefReessayer="/connaissances/derogations"
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune dérogation enregistrée." />
      ) : (
        <ul className="mp-connaissances__resultats">
          {r.donnees.elements.map((g) => (
            <li key={g.cle}>
              <Carte
                titre={`${libelleNature(g.nature)} de la brique « ${g.brique_code} »`}
                niveauTitre={2}
                actions={
                  g.au_dessus_du_seuil ? (
                    <BadgeStatut tonalite="attention">Fréquente</BadgeStatut>
                  ) : (
                    <BadgeStatut tonalite="neutre">Sous le seuil</BadgeStatut>
                  )
                }
              >
                <p>
                  {g.missions} missions · {g.derogations} dérogations ({g.approuvees} approuvées,{" "}
                  {g.refusees} refusées, {g.demandees} en attente)
                  {g.methode_code ? ` · méthode ${g.methode_code}` : ""}
                </p>
                {g.mots_cles.length > 0 ? (
                  <p className="mp-texte-petit mp-texte-doux">
                    Mots-clés : {g.mots_cles.map((m) => `${m.mot} (${m.occurrences})`).join(", ")}
                  </p>
                ) : null}
                {g.motifs.length > 0 ? (
                  <ul>
                    {g.motifs.slice(0, 5).map((m) => (
                      <li key={m.representant} className="mp-texte-petit">
                        {m.representant} {m.effectif > 1 ? `(${m.effectif} motifs proches)` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mp-texte-petit mp-texte-doux">
                    Motifs non visibles dans vos droits.
                  </p>
                )}
                {g.proposition ? (
                  <p className="mp-texte-petit">
                    Proposition soumise : {g.proposition.titre} ({g.proposition.statut}).
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
