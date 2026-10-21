import type { Metadata } from "next";
import "../../../../../../components/redressement/financement.css";
import { CovenantsFormulaire } from "../../../../../../components/redressement/CovenantsFormulaire";
import { CovenantsTableau } from "../../../../../../components/redressement/CovenantsTableau";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { FinancementFormulaire } from "../../../../../../components/redressement/FinancementFormulaire";
import {
  HistoriqueCovenants,
  HistoriqueFinancement,
} from "../../../../../../components/redressement/FinancementHistoriques";
import { FinancementPlanTableau } from "../../../../../../components/redressement/FinancementPlanTableau";
import { TresorerieMensuelleTableau } from "../../../../../../components/redressement/TresorerieMensuelleTableau";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { aujourdhui as aujourdhuiIso } from "../../../../../../lib/periode";
import { hrefRedressement, raisonSansEcriture } from "../../../../../../lib/redressement";
import {
  chargerCovenants,
  chargerFinancement,
  chargerTresorerieMensuelle,
} from "../../../../../../lib/redressement-financement-serveur";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export const metadata: Metadata = { title: "Financement du dossier" };

/**
 * Financement (RED-06, suite) : vue mensuelle de la trésorerie, covenants bancaires et plan de
 * financement. Chiffres, marges, statuts et totaux : ceux de l'API (moteurs). Les statuts de
 * covenant sont des constats arithmétiques, jamais une qualification juridique.
 */
export default async function PageFinancement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefRedressement(id, "financement")}
      />
    );
  }
  const { mission, dossier, droits, session } = ctx;
  const devise = dossier.devise;
  const jour = aujourdhuiIso();
  const [mensuel, covenants, financement] = await Promise.all([
    chargerTresorerieMensuelle(dossier.id),
    chargerCovenants(dossier.id),
    chargerFinancement(dossier.id),
  ]);
  const href = hrefRedressement(id, "financement");
  const sansEcriture = (
    <Alerte tonalite="info" annonce="aucune">
      <p>{raisonSansEcriture(mission, dossier, session.utilisateur.roles)}</p>
    </Alerte>
  );

  return (
    <div className="mp-red">
      <section className="mp-red-section" aria-labelledby="titre-mensuel">
        <h2 id="titre-mensuel" className="mp-red-section__titre">
          Trésorerie par mois
        </h2>
        {mensuel.ok ? (
          <TresorerieMensuelleTableau vue={mensuel.donnees} devise={devise} />
        ) : (
          <EtatErreur
            titre="La vue mensuelle n'a pas pu être chargée."
            message={mensuel.message}
            hrefReessayer={href}
          />
        )}
      </section>

      <section className="mp-red-section" aria-labelledby="titre-covenants">
        <h2 id="titre-covenants" className="mp-red-section__titre">
          Covenants
        </h2>
        {covenants.ok ? (
          <>
            <CovenantsTableau vue={covenants.donnees} />
            {covenants.donnees.historique.length > 0 ? (
              <Carte titre="Historique des versions de covenants" niveauTitre={3}>
                <HistoriqueCovenants versions={covenants.donnees.historique} />
              </Carte>
            ) : null}
            {droits.ecrire ? (
              <Carte titre="Nouvelle version de covenants" niveauTitre={3}>
                <CovenantsFormulaire
                  key={covenants.donnees.version?.id ?? "aucune"}
                  dossierId={dossier.id}
                  version={covenants.donnees.version}
                />
              </Carte>
            ) : (
              sansEcriture
            )}
          </>
        ) : (
          <EtatErreur
            titre="Les covenants n'ont pas pu être chargés."
            message={covenants.message}
            hrefReessayer={href}
          />
        )}
      </section>

      <section className="mp-red-section" aria-labelledby="titre-plan">
        <h2 id="titre-plan" className="mp-red-section__titre">
          Plan de financement
        </h2>
        {financement.ok ? (
          <>
            <FinancementPlanTableau vue={financement.donnees} devise={devise} />
            {financement.donnees.historique.length > 0 ? (
              <Carte titre="Historique des versions du plan" niveauTitre={3}>
                <HistoriqueFinancement versions={financement.donnees.historique} />
              </Carte>
            ) : null}
            {droits.ecrire ? (
              <Carte titre="Nouvelle version du plan de financement" niveauTitre={3}>
                <FinancementFormulaire
                  key={financement.donnees.version?.id ?? "aucune"}
                  dossierId={dossier.id}
                  devise={devise}
                  version={financement.donnees.version}
                  aujourdhui={jour}
                />
              </Carte>
            ) : (
              sansEcriture
            )}
          </>
        ) : (
          <EtatErreur
            titre="Le plan de financement n'a pas pu être chargé."
            message={financement.message}
            hrefReessayer={href}
          />
        )}
      </section>
    </div>
  );
}
